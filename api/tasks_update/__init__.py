import json, os
from datetime import datetime, timezone
import azure.functions as func
from azure.cosmos import CosmosClient, PartitionKey, exceptions

COSMOS_URL  = os.environ.get("COSMOS_URL") or os.environ.get("COSMOS_ENDPOINT")
COSMOS_KEY  = os.environ.get("COSMOS_KEY") or os.environ.get("COSMOS_PRIMARY_KEY")
COSMOS_DB   = os.environ.get("COSMOS_DB", "fieldops")
TASKS_CONT  = os.environ.get("COSMOS_CONTAINER_TASKS", "tasks")

def _json(body, status=200):
    return func.HttpResponse(json.dumps(body, ensure_ascii=False, default=str),
                             status_code=status, headers={"Content-Type":"application/json"})

def _bad(msg, code=400): return _json({"error": msg}, code)
def _now(): return datetime.now(timezone.utc).isoformat()

def _c():
    if not COSMOS_URL or not COSMOS_KEY:
        raise RuntimeError("Cosmos config missing")
    client = CosmosClient(COSMOS_URL, credential=COSMOS_KEY)
    db = client.create_database_if_not_exists(COSMOS_DB)
    try:
        return db.create_container_if_not_exists(id=TASKS_CONT, partition_key=PartitionKey(path="/tenantId"), offer_throughput=400)
    except Exception:
        return db.get_container_client(TASKS_CONT)

def main(req: func.HttpRequest) -> func.HttpResponse:
    if req.method.upper() == "OPTIONS":
        return func.HttpResponse(status_code=200)

    if req.method.upper() != "POST":
        return _bad("Use POST", 405)

    try:
        data = req.get_json()
    except ValueError:
        return _bad("Invalid JSON")

    tenantId = (data.get("tenantId") or "").strip()
    taskId   = (data.get("taskId") or "").strip()
    if not tenantId or not taskId:
        return _bad("tenantId and taskId are required")

    try:
        cont = _c()
        task = cont.read_item(item=taskId, partition_key=tenantId)
    except exceptions.CosmosResourceNotFoundError:
        return _bad("Task not found", 404)
    except Exception as e:
        return _bad(f"Cosmos error: {e}", 500)

    # Allowed fields
    if "title" in data:    task["title"] = (data["title"] or "").strip()
    if "type" in data:     task["type"] = (data["type"] or "").strip()
    if "assignee" in data: task["assignee"] = (data["assignee"] or "").strip().lower()
    if "slaStart" in data: task["slaStart"] = data["slaStart"] or None
    if "slaEnd"   in data: task["slaEnd"]   = data["slaEnd"] or None

    if isinstance(data.get("expenseLimits"), dict):
        el = data["expenseLimits"]
        task["expenseLimits"] = {
            "Hotel":  float(el.get("Hotel", 0)  or 0),
            "Food":   float(el.get("Food", 0)   or 0),
            "Travel": float(el.get("Travel", 0) or 0),
            "Other":  float(el.get("Other", 0)  or 0),
        }

    if isinstance(data.get("items"), list):
        norm = []
        for it in data["items"]:
            pid = (it.get("productId") or it.get("product") or "").strip()
            if not pid: continue
            try:
                qty = int(it.get("quantity") or 1)
            except Exception:
                qty = 1
            if qty < 1: qty = 1
            norm.append({"productId": pid, "quantity": qty})
        task["items"] = norm

    task["updatedAt"] = _now()
    cont.replace_item(task, task)
    return _json(task)
