import json
import os
import uuid
from datetime import datetime, timezone

import azure.functions as func
from azure.cosmos import CosmosClient, PartitionKey, exceptions

COSMOS_URL  = os.environ.get("COSMOS_URL") or os.environ.get("COSMOS_ENDPOINT")
COSMOS_KEY  = os.environ.get("COSMOS_KEY") or os.environ.get("COSMOS_PRIMARY_KEY")
COSMOS_DB   = os.environ.get("COSMOS_DB", "fieldops")
TASKS_CONT  = os.environ.get("COSMOS_CONTAINER_TASKS", "tasks")

def _container():
    client = CosmosClient(COSMOS_URL, credential=COSMOS_KEY)
    db = client.create_database_if_not_exists(COSMOS_DB)
    try:
        cont = db.create_container_if_not_exists(
            id=TASKS_CONT,
            partition_key=PartitionKey(path="/tenantId"),
            offer_throughput=400
        )
    except Exception:
        cont = db.get_container_client(TASKS_CONT)
    return cont

def _json(body, status=200):
    return func.HttpResponse(
        json.dumps(body, ensure_ascii=False, default=str),
        status_code=status,
        headers={"Content-Type": "application/json"}
    )

def _bad(msg, code=400):
    return _json({"error": msg}, status=code)

def _now_iso():
    return datetime.now(timezone.utc).isoformat()

def main(req: func.HttpRequest) -> func.HttpResponse:
    method = req.method.upper()

    # CORS preflight convenience
    if method == "OPTIONS":
        return func.HttpResponse(status_code=200)

    if not COSMOS_URL or not COSMOS_KEY:
        return _bad("Cosmos config missing: set COSMOS_URL and COSMOS_KEY in app settings", 500)

    cont = _container()

    if method == "GET":
        tenant = req.params.get("tenantId")
        if not tenant:
            return _bad("tenantId is required")
        query = "SELECT * FROM c WHERE c.tenantId = @t ORDER BY c.createdAt DESC"
        items = list(cont.query_items(
            query=query,
            parameters=[{"name":"@t","value":tenant}],
            enable_cross_partition_query=True
        ))
        return _json(items)

    if method == "POST":
        try:
            data = req.get_json()
        except ValueError:
            return _bad("Invalid JSON")

        tenantId = (data.get("tenantId") or "").strip()
        title    = (data.get("title") or "").strip()
        assignee = (data.get("assignee") or "").strip().lower()
        ttype    = (data.get("type") or "data_collection").strip()

        if not tenantId:
            return _bad("tenantId is required")
        if not title:
            return _bad("title is required")

        doc = {
            "id": data.get("id") or str(uuid.uuid4()),
            "tenantId": tenantId,
            "title": title,
            "type": ttype,
            "assignee": assignee,
            "status": "ASSIGNED",
            "slaStart": data.get("slaStart") or None,
            "slaEnd": data.get("slaEnd") or None,
            "expenseLimits": data.get("expenseLimits") or {"Hotel":1000,"Food":1000,"Travel":1000,"Other":1000},
            "items": data.get("items") or [],  # [{productId, quantity}]
            "createdAt": _now_iso(),
            "updatedAt": _now_iso()
        }
        cont.create_item(doc)
        return _json(doc, status=201)

    if method == "PUT":
        try:
            data = req.get_json()
        except ValueError:
            return _bad("Invalid JSON")

        tenantId = (data.get("tenantId") or "").strip()
        taskId   = (data.get("taskId") or "").strip()
        if not tenantId or not taskId:
            return _bad("tenantId and taskId are required for PUT")

        try:
            task = cont.read_item(item=taskId, partition_key=tenantId)
        except exceptions.CosmosResourceNotFoundError:
            return _bad("Task not found", code=404)

        # Patch allowed fields only
        if "title" in data:          task["title"] = (data["title"] or "").strip()
        if "type" in data:           task["type"] = (data["type"] or "").strip()
        if "assignee" in data:       task["assignee"] = (data["assignee"] or "").strip().lower()
        if "slaStart" in data:       task["slaStart"] = data["slaStart"] or None
        if "slaEnd"   in data:       task["slaEnd"]   = data["slaEnd"] or None
        if "expenseLimits" in data and isinstance(data["expenseLimits"], dict):
            el = data["expenseLimits"]
            task["expenseLimits"] = {
                "Hotel":  float(el.get("Hotel", 0)) if el.get("Hotel") is not None else 0,
                "Food":   float(el.get("Food", 0)) if el.get("Food") is not None else 0,
                "Travel": float(el.get("Travel", 0)) if el.get("Travel") is not None else 0,
                "Other":  float(el.get("Other", 0)) if el.get("Other") is not None else 0,
            }
        if "items" in data and isinstance(data["items"], list):
            norm = []
            for it in data["items"]:
                pid = (it.get("productId") or it.get("product") or "").strip()
                if not pid:
                    continue
                qty = it.get("quantity")
                try:
                    qty = int(qty)
                except Exception:
                    qty = 1
                if qty < 1:
                    qty = 1
                norm.append({"productId": pid, "quantity": qty})
            task["items"] = norm

        task["updatedAt"] = _now_iso()
        cont.replace_item(task, task)
        return _json(task)

    return _json({"error": f"Method {method} not allowed"}, status=405)
