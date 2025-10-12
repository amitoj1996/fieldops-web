import json, os, logging, datetime
import azure.functions as func
from azure.cosmos import CosmosClient, exceptions

# ---- helpers -------------------------------------------------
def _bad(msg, code=400):
    return func.HttpResponse(
        json.dumps({"error": msg}),
        status_code=code,
        mimetype="application/json"
    )

def _json(payload, code=200):
    return func.HttpResponse(
        json.dumps(payload, default=str),
        status_code=code,
        mimetype="application/json"
    )

def _now():
    return datetime.datetime.utcnow().isoformat() + "Z"

def _container():
    url = os.environ.get("COSMOS_URL")
    key = os.environ.get("COSMOS_KEY")
    dbn = os.environ.get("COSMOS_DB")
    cn  = os.environ.get("COSMOS_CONTAINER")  # e.g., "tasks"
    if not all([url, key, dbn, cn]):
        raise RuntimeError("COSMOS_URL, COSMOS_KEY, COSMOS_DB, COSMOS_CONTAINER must be set")
    cli = CosmosClient(url, credential=key)
    db  = cli.get_database_client(dbn)
    return db.get_container_client(cn)

# ---- main ----------------------------------------------------
def main(req: func.HttpRequest) -> func.HttpResponse:
    # Preflight
    if req.method == "OPTIONS":
        return func.HttpResponse(
            status_code=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST,PUT,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization"
            }
        )

    try:
        raw = req.get_body()
        data = json.loads(raw.decode("utf-8") or "{}") if raw else {}
    except ValueError:
        return _bad("Invalid JSON")

    # Support both `taskId` and legacy `id`
    tenantId = (data.get("tenantId") or "").strip()
    taskId   = (data.get("taskId") or data.get("id") or "").strip()
    if not tenantId or not taskId:
        return _bad("tenantId and taskId are required")

    try:
        cont = _container()
        task = cont.read_item(item=taskId, partition_key=tenantId)
    except exceptions.CosmosResourceNotFoundError:
        return _bad("Task not found", 404)
    except Exception as e:
        logging.exception("Cosmos read failed")
        return _bad(f"Cosmos error: {e}", 500)

    # Allowed/normalized updates
    if "title"    in data: task["title"]    = (data["title"]    or "").strip()
    if "type"     in data: task["type"]     = (data["type"]     or "").strip()
    if "assignee" in data: task["assignee"] = (data["assignee"] or "").strip().lower()
    if "slaStart" in data: task["slaStart"] = data["slaStart"] or None
    if "slaEnd"   in data: task["slaEnd"]   = data["slaEnd"]   or None

    # Expense limits (Hotel/Food/Travel/Other)
    if isinstance(data.get("expenseLimits"), dict):
        el = data["expenseLimits"]
        task["expenseLimits"] = {
            "Hotel":  float(el.get("Hotel", 0)  or 0),
            "Food":   float(el.get("Food", 0)   or 0),
            "Travel": float(el.get("Travel", 0) or 0),
            "Other":  float(el.get("Other", 0)  or 0),
        }

    # Items: accept either productId or product; coerce qty>=1
    if isinstance(data.get("items"), list):
        norm = []
        for it in data["items"]:
            pid = (it.get("productId") or it.get("product") or "").strip()
            if not pid:
                continue
            try:
                qty = int(it.get("quantity") or 1)
            except Exception:
                qty = 1
            if qty < 1:
                qty = 1
            norm.append({"productId": pid, "quantity": qty})
        task["items"] = norm

    task["updatedAt"] = _now()

    try:
        cont.replace_item(task, task)
    except Exception as e:
        logging.exception("Cosmos replace failed")
        return _bad(f"Cosmos error: {e}", 500)

    return _json(task)
