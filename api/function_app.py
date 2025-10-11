import os, json, uuid, re, time
from datetime import datetime, timezone, timedelta

import azure.functions as func

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# ---------- Cosmos helpers ----------
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
        # default partition key for new containers
        c = db.create_container_if_not_exists(
            id=container_name, partition_key=PartitionKey(path="/tenantId")
        )
    return c

def _tasks_container():
    return _get_container_named(os.environ.get("COSMOS_CONTAINER", "Tasks"))

def _expenses_container():
    return _get_container_named(os.environ.get("EXPENSES_CONTAINER", "Expenses"))

# ---------- Blob helpers ----------
from azure.storage.blob import (
    BlobServiceClient,
    generate_blob_sas,
    BlobSasPermissions,
)
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
    from azure.storage.blob import generate_blob_sas
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

# ---------- Routes ----------
@app.route(route="hello", methods=["GET"])
def hello(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("Hello from Python Functions, world!", status_code=200)

# ---- Tasks (Cosmos) ----
@app.route(route="tasks", methods=["POST"])
def create_task(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
        c = _tasks_container()
        item = {
            "id": data.get("id") or str(uuid.uuid4()),
            "tenantId": data.get("tenantId", "default"),
            "type": data.get("type", "data_collection"),
            "title": data.get("title", ""),
            "assignee": data.get("assignee", ""),
            "slaStart": data.get("slaStart"),
            "slaEnd": data.get("slaEnd"),
            "status": data.get("status", "ASSIGNED"),
            "createdAt": datetime.now(timezone.utc).isoformat(),
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

# ---- Receipts: SAS + list ----
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

# ---- OCR: call Azure Document Intelligence prebuilt-receipt ----
@app.route(route="receipts/ocr", methods=["POST"])
def receipts_ocr(req: func.HttpRequest) -> func.HttpResponse:
    """
    Body: { "taskId": "...", "filename": "receipt.jpg", "tenantId": "default", "save": true }
    - Generates a **read** SAS to the blob
    - Calls Document Intelligence prebuilt-receipt
    - Extracts merchant, date, total (+currency if present)
    - If save=true, writes an Expense doc to Cosmos (Expenses container)
    """
    try:
        data = req.get_json()
        task_id  = data.get("taskId")
        filename = data.get("filename")
        tenant   = data.get("tenantId", "default")
        save     = bool(data.get("save", True))
        if not task_id or not filename:
            return func.HttpResponse(json.dumps({"error":"taskId and filename are required"}),
                                     mimetype="application/json", status_code=400)

        # 1) read SAS for the blob
        blob_url, read_url = _make_blob_urls(task_id, filename, for_read=True, minutes=10)

        # 2) call DI
        import requests
        endpoint = os.environ["DI_ENDPOINT"].rstrip("/")
        key      = os.environ["DI_KEY"]
        api_ver  = os.environ.get("DI_API_VERSION", "2023-07-31")
        model_id = "prebuilt-receipt"

        analyze_url = f"{endpoint}/formrecognizer/documentModels/{model_id}:analyze?api-version={api_ver}"
        headers = {"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json"}
        payload = {"urlSource": read_url}

        # submit
        r = requests.post(analyze_url, headers=headers, json=payload, timeout=30)
        if r.status_code not in (200, 202):
            return func.HttpResponse(json.dumps({"error":"analyze submit failed", "status": r.status_code, "body": r.text}),
                                     mimetype="application/json", status_code=502)

        # poll
        op_url = r.headers.get("operation-location") or r.headers.get("Operation-Location")
        if not op_url:
            # some API versions return result inline
            result = r.json()
        else:
            for _ in range(20):
                time.sleep(1)
                pr = requests.get(op_url, headers={"Ocp-Apim-Subscription-Key": key}, timeout=20)
                result = pr.json()
                if result.get("status") in ("succeeded", "failed", "cancelled"):
                    break

        # 3) extract fields defensively
        doc = {}
        # try new schema first
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

        out = {
            "taskId": task_id,
            "tenantId": tenant,
            "blobPath": blob_url,
            "ocr": doc,
            "raw": result.get("analyzeResult", result)  # keep a raw snapshot for debugging
        }

        # 4) optionally save as an Expense document
        if save:
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
                "ocrModel": model_id,
                "ocrApiVersion": api_ver,
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "isManualOverride": False
            }
            _expenses_container().create_item(exp)
            out["saved"] = exp

        return func.HttpResponse(json.dumps(out), mimetype="application/json", status_code=200)

    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}),
                                 mimetype="application/json", status_code=500)

# ---- Expenses: list (simple helper to verify saves) ----
@app.route(route="expenses", methods=["GET"])
def expenses_list(req: func.HttpRequest) -> func.HttpResponse:
    try:
        tenant = req.params.get("tenantId", "default")
        c = _expenses_container()
        q = "SELECT * FROM c WHERE c.tenantId = @t AND c.docType = 'Expense' ORDER BY c.createdAt DESC"
        items = list(c.query_items(q, parameters=[{"name":"@t","value": tenant}], enable_cross_partition_query=True))
        return func.HttpResponse(json.dumps(items), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}),
                                 mimetype="application/json", status_code=500)
