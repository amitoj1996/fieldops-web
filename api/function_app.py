import os, json, uuid, re, time
from datetime import datetime, timezone, timedelta

import azure.functions as func

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# ---------------------------
# Cosmos helpers
# ---------------------------
def _get_container_named(container_name: str):
    from azure.cosmos import CosmosClient, PartitionKey
    endpoint = os.environ.get("COSMOS_ENDPOINT")
    key = os.environ.get("COSMOS_KEY")
    db_name = os.environ.get("COSMOS_DB", "fieldops")
    if not endpoint or not key:
        raise RuntimeError("Missing Cosmos settings (COSMOS_ENDPOINT/COSMOS_KEY).")
    client = CosmosClient(endpoint, key)
    db = client.create_database_if_not_exists(db_name)
    try:
        c = db.get_container_client(container_name)
        _ = c.read()
    except Exception:
        c = db.create_container_if_not_exists(
            id=container_name, partition_key=PartitionKey(path="/tenantId")
        )
    return c

def _tasks_container():
    return _get_container_named(os.environ.get("COSMOS_CONTAINER", "Tasks"))

def _expenses_container():
    return _get_container_named(os.environ.get("EXPENSES_CONTAINER", "Expenses"))

def _events_container():
    # Use Tasks container by default to avoid RU spikes from a new container
    return _get_container_named(os.environ.get("EVENTS_CONTAINER", "Tasks"))

DEFAULT_LIMITS = {"Hotel": 1000, "Food": 1000, "Travel": 1000, "Other": 1000}

def _get_task(tenant_id: str, task_id: str):
    c = _tasks_container()
    try:
        return c.read_item(item=task_id, partition_key=tenant_id)
    except Exception:
        q = "SELECT * FROM c WHERE c.docType='Task' AND c.tenantId=@t AND c.id=@id"
        items = list(c.query_items(q, parameters=[{"name":"@t","value":tenant_id},{"name":"@id","value":task_id}], enable_cross_partition_query=True))
        return items[0] if items else None

def _save_task(doc):
    _tasks_container().replace_item(item=doc, body=doc)

def _now_iso():
    return datetime.now(timezone.utc).isoformat()

def _parse_iso(s):
    if not s: return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None

# ---------------------------
# Blob helpers (receipts)
# ---------------------------
from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions

SAFE_NAME = re.compile(r"[^a-zA-Z0-9._/-]+")

def _sanitize_blob_name(name: str) -> str:
    return SAFE_NAME.sub("-", (name or "").strip()).strip("/")

def _blob_service():
    account = os.environ["STG_ACCOUNT"]
    key = os.environ["STG_KEY"]
    url = f"https://{account}.blob.core.windows.net"
    return BlobServiceClient(account_url=url, credential=key)

def _make_blob_urls(task_id: str, filename: str, *, for_read=False, for_write=False, minutes=10):
    account   = os.environ["STG_ACCOUNT"]
    key       = os.environ["STG_KEY"]
    container = os.environ.get("STG_CONTAINER", "receipts")
    blob_name = _sanitize_blob_name(f"{task_id}/{filename}")
    perms = BlobSasPermissions(read=for_read, write=for_write, create=for_write)
    sas = generate_blob_sas(
        account_name=account,
        container_name=container,
        blob_name=blob_name,
        account_key=key,
        permission=perms,
        expiry=datetime.utcnow() + timedelta(minutes=minutes),
    )
    blob_url = f"https://{account}.blob.core.windows.net/{container}/{blob_name}"
    return blob_url, f"{blob_url}?{sas}"

# ---------------------------
# Routes
# ---------------------------
@app.route(route="hello", methods=["GET"])
def hello(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("Hello from Python Functions, world!", status_code=200)

# ---- Tasks (create/list + limits)
@app.route(route="tasks", methods=["POST"])
def create_task(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
        c = _tasks_container()
        limits = data.get("expenseLimits") or DEFAULT_LIMITS.copy()
        item = {
            "id": data.get("id") or str(uuid.uuid4()),
            "tenantId": data.get("tenantId", "default"),
            "type": data.get("type", "data_collection"),
            "title": data.get("title", ""),
            "assignee": data.get("assignee", ""),
            "slaStart": data.get("slaStart"),
            "slaEnd": data.get("slaEnd"),
            "status": data.get("status", "ASSIGNED"),
            "expenseLimits": limits,
            "createdAt": _now_iso(),
            "docType": "Task"
        }
        c.create_item(item)
        return func.HttpResponse(json.dumps(item), mimetype="application/json", status_code=201)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="tasks", methods=["GET"])
def list_tasks(req: func.HttpRequest) -> func.HttpResponse:
    try:
        tenant = req.params.get("tenantId", "default")
        c = _tasks_container()
        q = "SELECT * FROM c WHERE c.tenantId = @t AND c.docType = 'Task' ORDER BY c.createdAt DESC"
        items = list(c.query_items(q, parameters=[{"name":"@t","value": tenant}], enable_cross_partition_query=True))
        return func.HttpResponse(json.dumps(items), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="tasks/limits", methods=["PUT"])
def update_task_limits(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
        task_id = data.get("taskId")
        tenant  = data.get("tenantId", "default")
        limits  = data.get("expenseLimits")
        if not task_id or not isinstance(limits, dict):
            return func.HttpResponse(json.dumps({"error":"taskId and expenseLimits required"}),
                                     mimetype="application/json", status_code=400)
        c = _tasks_container()
        item = c.read_item(item=task_id, partition_key=tenant)
        item["expenseLimits"] = limits
        _save_task(item)
        return func.HttpResponse(json.dumps(item), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

# ---- Check-in/out + Timeline (idempotent)
@app.route(route="tasks/checkin", methods=["POST"])
def tasks_checkin(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
        tenant = data.get("tenantId","default")
        task_id = data.get("taskId")
        lat = data.get("lat"); lng = data.get("lng")
        actor = data.get("actor") or data.get("employeeId")
        if not task_id:
            return func.HttpResponse(json.dumps({"error":"taskId required"}), mimetype="application/json", status_code=400)
        task = _get_task(tenant, task_id)
        if not task:
            return func.HttpResponse(json.dumps({"error":"task not found"}), mimetype="application/json", status_code=404)

        evc = _events_container()
        q = ("SELECT TOP 1 * FROM c WHERE c.docType='TaskEvent' AND c.tenantId=@t "
             "AND c.taskId=@task AND c.eventType='CHECK_IN' ORDER BY c.ts ASC")
        existing = list(evc.query_items(q, parameters=[{"name":"@t","value":tenant},{"name":"@task","value":task_id}], enable_cross_partition_query=True))
        if existing:
            return func.HttpResponse(json.dumps({"event": existing[0], "idempotent": True}), mimetype="application/json", status_code=200)

        ev = {"id": str(uuid.uuid4()), "docType":"TaskEvent", "tenantId": tenant, "taskId": task_id,
              "eventType":"CHECK_IN", "ts": _now_iso(), "lat": lat, "lng": lng}
        if actor: ev["actor"] = actor
        evc.create_item(ev)
        task["status"] = "IN_PROGRESS"; task["checkInAt"] = ev["ts"]
        _save_task(task)
        return func.HttpResponse(json.dumps({"event": ev, "idempotent": False}), mimetype="application/json", status_code=201)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="tasks/checkout", methods=["POST"])
def tasks_checkout(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
        tenant = data.get("tenantId","default")
        task_id = data.get("taskId")
        reason = data.get("reason")
        lat = data.get("lat"); lng = data.get("lng")
        actor = data.get("actor") or data.get("employeeId")
        if not task_id:
            return func.HttpResponse(json.dumps({"error":"taskId required"}), mimetype="application/json", status_code=400)
        task = _get_task(tenant, task_id)
        if not task:
            return func.HttpResponse(json.dumps({"error":"task not found"}), mimetype="application/json", status_code=404)

        evc = _events_container()
        q_out = ("SELECT TOP 1 * FROM c WHERE c.docType='TaskEvent' AND c.tenantId=@t "
                 "AND c.taskId=@task AND c.eventType='CHECK_OUT' ORDER BY c.ts ASC")
        existing_out = list(evc.query_items(q_out, parameters=[{"name":"@t","value":tenant},{"name":"@task","value":task_id}], enable_cross_partition_query=True))
        if existing_out:
            return func.HttpResponse(json.dumps({"event": existing_out[0], "idempotent": True, "task": task}),
                                     mimetype="application/json", status_code=200)

        q_in = ("SELECT TOP 1 * FROM c WHERE c.docType='TaskEvent' AND c.tenantId=@t "
                "AND c.taskId=@task AND c.eventType='CHECK_IN' ORDER BY c.ts ASC")
        existing_in = list(evc.query_items(q_in, parameters=[{"name":"@t","value":tenant},{"name":"@task","value":task_id}], enable_cross_partition_query=True))
        if not existing_in:
            return func.HttpResponse(json.dumps({"error":"must check in before checking out"}), mimetype="application/json", status_code=400)

        now = datetime.now(timezone.utc)
        sla_end = _parse_iso(task.get("slaEnd"))
        late = bool(sla_end and now > sla_end)
        if late and not reason:
            return func.HttpResponse(json.dumps({"error":"reason required because task is beyond SLA"}), mimetype="application/json", status_code=400)

        ev = {"id": str(uuid.uuid4()), "docType":"TaskEvent", "tenantId": tenant, "taskId": task_id,
              "eventType":"CHECK_OUT", "ts": _now_iso(), "lat": lat, "lng": lng, "late": late, "reason": reason}
        if actor: ev["actor"] = actor
        evc.create_item(ev)

        task["status"] = "COMPLETED"; task["checkOutAt"] = ev["ts"]; task["slaBreached"] = late
        if reason: task["lateReason"] = reason
        _save_task(task)

        return func.HttpResponse(json.dumps({"event": ev, "idempotent": False, "task": task}),
                                 mimetype="application/json", status_code=201)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="tasks/events", methods=["GET"])
def tasks_events(req: func.HttpRequest) -> func.HttpResponse:
    try:
        tenant = req.params.get("tenantId", "default")
        task_id = req.params.get("taskId")
        if not task_id:
            return func.HttpResponse(json.dumps({"error":"taskId required"}), mimetype="application/json", status_code=400)
        c = _events_container()
        q = ("SELECT * FROM c WHERE c.docType='TaskEvent' AND c.tenantId=@t "
             "AND c.taskId=@task ORDER BY c.ts ASC")
        items = list(c.query_items(q, parameters=[{"name":"@t","value":tenant},{"name":"@task","value":task_id}], enable_cross_partition_query=True))
        return func.HttpResponse(json.dumps(items), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

# ---- Receipts: SAS + readSas + list
@app.route(route="receipts/sas", methods=["GET"])
def receipts_sas(req: func.HttpRequest) -> func.HttpResponse:
    try:
        task_id  = req.params.get("taskId")
        filename = req.params.get("filename")
        if not task_id or not filename:
            return func.HttpResponse(json.dumps({"error":"taskId and filename are required"}),
                                     mimetype="application/json", status_code=400)
        blob_url, upload_url = _make_blob_urls(task_id, filename, for_write=True, minutes=10)
        return func.HttpResponse(json.dumps({"blobUrl": blob_url, "uploadUrl": upload_url}),
                                 mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="receipts/readSas", methods=["GET"])
def receipts_read_sas(req: func.HttpRequest) -> func.HttpResponse:
    try:
        task_id  = req.params.get("taskId")
        filename = req.params.get("filename")
        minutes  = int(req.params.get("minutes", "5"))
        if not task_id or not filename:
            return func.HttpResponse(json.dumps({"error":"taskId and filename are required"}),
                                     mimetype="application/json", status_code=400)
        blob_url, read_url = _make_blob_urls(task_id, filename, for_read=True, minutes=minutes)
        return func.HttpResponse(json.dumps({"blobUrl": blob_url, "readUrl": read_url}),
                                 mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="receipts/list", methods=["GET"])
def receipts_list(req: func.HttpRequest) -> func.HttpResponse:
    try:
        account   = os.environ["STG_ACCOUNT"]
        key       = os.environ["STG_KEY"]
        container = os.environ.get("STG_CONTAINER", "receipts")
        task_id   = req.params.get("taskId")
        if not task_id:
            return func.HttpResponse(json.dumps({"error":"taskId required"}),
                                     mimetype="application/json", status_code=400)
        svc = _blob_service()
        cont = svc.get_container_client(container)
        items = [b.name for b in cont.list_blobs(name_starts_with=f"{task_id}/")]
        return func.HttpResponse(json.dumps({"files": items}), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

# ---- OCR + Expenses (OCR is **upsert**/idempotent)
@app.route(route="receipts/ocr", methods=["POST"])
def receipts_ocr(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
        task_id  = data.get("taskId")
        filename = data.get("filename")
        tenant   = data.get("tenantId", "default")
        save     = bool(data.get("save", True))
        if not task_id or not filename:
            return func.HttpResponse(json.dumps({"error":"taskId and filename are required"}),
                                     mimetype="application/json", status_code=400)

        blob_url, read_url = _make_blob_urls(task_id, filename, for_read=True, minutes=10)

        import requests
        endpoint = os.environ["DI_ENDPOINT"].rstrip("/")
        key      = os.environ["DI_KEY"]
        api_ver  = os.environ.get("DI_API_VERSION", "2023-07-31")
        model_id = "prebuilt-receipt"

        analyze_url = f"{endpoint}/formrecognizer/documentModels/{model_id}:analyze?api-version={api_ver}"
        headers = {"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json"}
        payload = {"urlSource": read_url}

        r = requests.post(analyze_url, headers=headers, json=payload, timeout=30)
        if r.status_code not in (200, 202):
            return func.HttpResponse(json.dumps({"error":"analyze submit failed", "status": r.status_code, "body": r.text}),
                                     mimetype="application/json", status_code=502)

        op_url = r.headers.get("operation-location") or r.headers.get("Operation-Location")
        if not op_url:
            result = r.json()
        else:
            for _ in range(20):
                time.sleep(1)
                pr = requests.get(op_url, headers={"Ocp-Apim-Subscription-Key": key}, timeout=20)
                result = pr.json()
                if result.get("status") in ("succeeded", "failed", "cancelled"):
                    break

        doc = {}
        try:
            docs = result.get("analyzeResult", {}).get("documents", [])
            f = (docs[0].get("fields", {}) if docs else {})
            def _val(x):
                if not isinstance(x, dict): return x
                for k in ("valueNumber","valueString","valueDate","content"):
                    if k in x: return x[k]
                vc = x.get("valueCurrency")
                if isinstance(vc, dict) and "amount" in vc: return vc["amount"]
                return x.get("content")
            merchant = _val(f.get("MerchantName", {}))
            total    = _val(f.get("Total", {}))
            date     = _val(f.get("TransactionDate", {}))
            currency = None
            vc = f.get("Total", {}).get("valueCurrency") if isinstance(f.get("Total", {}), dict) else None
            if isinstance(vc, dict):
                currency = vc.get("currencyCode") or vc.get("currencySymbol")
            doc = {"merchant": merchant, "total": total, "date": date, "currency": currency}
        except Exception:
            doc = {}

        out = {"taskId": task_id, "tenantId": tenant, "blobPath": blob_url, "ocr": doc}

        if save:
            c = _expenses_container()
            q = ("SELECT TOP 1 * FROM c WHERE c.docType='Expense' AND c.tenantId=@t "
                 "AND c.taskId=@task AND c.blobPath=@blob")
            items = list(c.query_items(q, parameters=[
                {"name":"@t","value":tenant},
                {"name":"@task","value":task_id},
                {"name":"@blob","value":blob_url}
            ], enable_cross_partition_query=True))

            if items:
                exp = items[0]
                exp["merchant"] = doc.get("merchant", exp.get("merchant"))
                exp["total"]    = doc.get("total",    exp.get("total"))
                exp["currency"] = doc.get("currency", exp.get("currency"))
                exp["txnDate"]  = doc.get("date",     exp.get("txnDate"))
                exp["ocrModel"] = "prebuilt-receipt"
                exp["ocrApiVersion"] = api_ver
                c.replace_item(item=exp, body=exp)
                out["saved"] = exp
                out["idempotent"] = True
            else:
                exp = {
                    "id": str(uuid.uuid4()),
                    "docType": "Expense",
                    "tenantId": tenant,
                    "taskId": task_id,
                    "blobPath": blob_url,
                    "merchant": doc.get("merchant"),
                    "total": doc.get("total"),
                    "currency": doc.get("currency"),
                    "txnDate": doc.get("date"),
                    "category": None,
                    "ocrModel": "prebuilt-receipt",
                    "ocrApiVersion": api_ver,
                    "createdAt": _now_iso(),
                    "isManualOverride": False,
                    "approval": None
                }
                c.create_item(exp)
                out["saved"] = exp
                out["idempotent"] = False

        return func.HttpResponse(json.dumps(out), mimetype="application/json", status_code=200)

    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}),
                                 mimetype="application/json", status_code=500)

@app.route(route="expenses/finalize", methods=["POST"])
def expenses_finalize(req: func.HttpRequest) -> func.HttpResponse:
    try:
      data = req.get_json()
      tenant = data.get("tenantId","default")
      category = data.get("category")
      if not category:
          return func.HttpResponse(json.dumps({"error":"category is required"}), mimetype="application/json", status_code=400)

      c = _expenses_container()
      expense = None
      if data.get("expenseId"):
          expense = c.read_item(item=data["expenseId"], partition_key=tenant)
      else:
          q = "SELECT * FROM c WHERE c.docType='Expense' AND c.tenantId=@t AND c.taskId=@task AND c.blobPath=@blob"
          items = list(c.query_items(q, parameters=[
              {"name":"@t","value":tenant},
              {"name":"@task","value":data.get("taskId")},
              {"name":"@blob","value":data.get("blobPath")}
          ], enable_cross_partition_query=True))
          if items: expense = items[0]
      if not expense:
          return func.HttpResponse(json.dumps({"error":"expense not found"}), mimetype="application/json", status_code=404)

      original_total = expense.get("total")
      edited_total = data.get("total", original_total)
      try:
          edited_total = float(edited_total) if edited_total is not None else None
      except Exception:
          return func.HttpResponse(json.dumps({"error":"total must be a number"}), mimetype="application/json", status_code=400)

      expense["category"] = category
      expense["editedTotal"] = edited_total
      expense["isManualOverride"] = bool(edited_total is not None and original_total is not None and float(edited_total) != float(original_total))
      if data.get("comment"): expense["comment"] = data["comment"]
      if data.get("submittedBy"): expense["submittedBy"] = data["submittedBy"]

      task = _get_task(expense.get("tenantId","default"), expense.get("taskId"))
      limits = (task or {}).get("expenseLimits") or DEFAULT_LIMITS
      limit_for_cat = limits.get(category, limits.get("Other", 1000))

      status = "AUTO_APPROVED" if (edited_total or 0) <= limit_for_cat else "PENDING_REVIEW"
      reason = "within limit" if status=="AUTO_APPROVED" else f"exceeds limit ({edited_total} > {limit_for_cat})"
      # Overwrite approval each finalize (clears old rejection notes)
      expense["approval"] = {
          "status": status,
          "evaluatedAt": _now_iso(),
          "limit": limit_for_cat,
          "reason": reason
      }

      c.replace_item(item=expense, body=expense)
      return func.HttpResponse(json.dumps(expense), mimetype="application/json", status_code=200)

    except Exception as e:
      return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="expenses", methods=["GET"])
def expenses_list(req: func.HttpRequest) -> func.HttpResponse:
    try:
        tenant = req.params.get("tenantId", "default")
        c = _expenses_container()
        q = "SELECT * FROM c WHERE c.tenantId = @t AND c.docType = 'Expense' ORDER BY c.createdAt DESC"
        items = list(c.query_items(q, parameters=[{"name":"@t","value": tenant}], enable_cross_partition_query=True))
        return func.HttpResponse(json.dumps(items), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="expenses/byTask", methods=["GET"])
def expenses_by_task(req: func.HttpRequest) -> func.HttpResponse:
    try:
        tenant = req.params.get("tenantId", "default")
        task_id = req.params.get("taskId")
        if not task_id:
            return func.HttpResponse(json.dumps({"error":"taskId required"}), mimetype="application/json", status_code=400)
        c = _expenses_container()
        q = "SELECT * FROM c WHERE c.tenantId=@t AND c.docType='Expense' AND c.taskId=@task ORDER BY c.createdAt DESC"
        items = list(c.query_items(q, parameters=[{"name":"@t","value": tenant},{"name":"@task","value": task_id}], enable_cross_partition_query=True))
        return func.HttpResponse(json.dumps(items), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

# ---- Admin approval queue
@app.route(route="expenses/pending", methods=["GET"])
def expenses_pending(req: func.HttpRequest) -> func.HttpResponse:
    try:
        tenant = req.params.get("tenantId", "default")
        c = _expenses_container()
        q = ("SELECT * FROM c WHERE c.docType='Expense' AND c.tenantId=@t "
             "AND c.approval.status='PENDING_REVIEW' ORDER BY c.createdAt ASC")
        items = list(c.query_items(q, parameters=[{"name":"@t","value": tenant}], enable_cross_partition_query=True))
        return func.HttpResponse(json.dumps(items), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

def _decide_expense(expense_id: str, tenant: str, status: str, note: str, decided_by: str):
    c = _expenses_container()
    exp = c.read_item(item=expense_id, partition_key=tenant)
    appr = exp.get("approval") or {}
    appr["status"] = status
    appr["decidedAt"] = _now_iso()
    appr["decidedBy"] = decided_by or "admin"
    if status == "REJECTED":
        appr["note"] = note  # feedback for employee
    elif note:
        # allow optional approve note; employees won't see it in UI unless REJECTED
        appr["note"] = note
    exp["approval"] = appr
    c.replace_item(item=exp, body=exp)
    return exp

@app.route(route="expenses/approve", methods=["POST"])
def expenses_approve(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
        tenant = data.get("tenantId","default")
        expense_id = data.get("expenseId")
        note = data.get("note")
        decided_by = data.get("decidedBy","admin")
        if not expense_id:
            return func.HttpResponse(json.dumps({"error":"expenseId required"}), mimetype="application/json", status_code=400)
        exp = _decide_expense(expense_id, tenant, "APPROVED", note, decided_by)
        return func.HttpResponse(json.dumps(exp), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="expenses/reject", methods=["POST"])
def expenses_reject(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
        tenant = data.get("tenantId","default")
        expense_id = data.get("expenseId")
        note = (data.get("note") or "").strip()
        decided_by = data.get("decidedBy","admin")
        if not expense_id:
            return func.HttpResponse(json.dumps({"error":"expenseId required"}), mimetype="application/json", status_code=400)
        if not note:
            return func.HttpResponse(json.dumps({"error":"note required to reject"}), mimetype="application/json", status_code=400)
        exp = _decide_expense(expense_id, tenant, "REJECTED", note, decided_by)
        return func.HttpResponse(json.dumps(exp), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)
