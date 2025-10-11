import os, json, uuid, re
from datetime import datetime, timezone, timedelta

import azure.functions as func

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# ---------- Cosmos helpers (Tasks) ----------
def _get_container():
    """Lazy-init Cosmos DB container so /hello never fails."""
    from azure.cosmos import CosmosClient, PartitionKey

    endpoint = os.environ.get("COSMOS_ENDPOINT")
    key = os.environ.get("COSMOS_KEY")
    db_name = os.environ.get("COSMOS_DB", "fieldops")
    container_name = os.environ.get("COSMOS_CONTAINER", "Tasks")

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

# ---------- Blob helpers (Receipts) ----------
from azure.storage.blob import (
    BlobServiceClient,
    generate_blob_sas,
    BlobSasPermissions,
)

SAFE_NAME = re.compile(r"[^a-zA-Z0-9._/-]+")

def _sanitize_blob_name(name: str) -> str:
    s = SAFE_NAME.sub("-", (name or "").strip())
    return s.strip("/")

def _blob_service():
    account = os.environ["STG_ACCOUNT"]
    key = os.environ["STG_KEY"]
    url = f"https://{account}.blob.core.windows.net"
    return BlobServiceClient(account_url=url, credential=key)

# ---------- Routes ----------
@app.route(route="hello", methods=["GET"])
def hello(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("Hello from Python Functions, world!", status_code=200)

@app.route(route="tasks", methods=["POST"])
def create_task(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
        c = _get_container()
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
        }
        c.create_item(item)
        return func.HttpResponse(json.dumps(item), mimetype="application/json", status_code=201)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="tasks", methods=["GET"])
def list_tasks(req: func.HttpRequest) -> func.HttpResponse:
    try:
        tenant = req.params.get("tenantId", "default")
        c = _get_container()
        q = "SELECT * FROM c WHERE c.tenantId = @t ORDER BY c.createdAt DESC"
        items = list(c.query_items(q, parameters=[{"name":"@t","value": tenant}], enable_cross_partition_query=True))
        return func.HttpResponse(json.dumps(items), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="receipts/sas", methods=["GET"])
def get_receipt_sas(req: func.HttpRequest) -> func.HttpResponse:
    """Return a short-lived SAS URL to upload a receipt to a private container."""
    try:
        account   = os.environ["STG_ACCOUNT"]
        key       = os.environ["STG_KEY"]
        container = os.environ.get("STG_CONTAINER", "receipts")

        task_id  = req.params.get("taskId")
        filename = req.params.get("filename")
        if not task_id or not filename:
            return func.HttpResponse(json.dumps({"error": "taskId and filename are required"}),
                                     mimetype="application/json", status_code=400)

        blob_name = _sanitize_blob_name(f"{task_id}/{filename}")

        sas = generate_blob_sas(
            account_name=account,
            container_name=container,
            blob_name=blob_name,
            account_key=key,
            permission=BlobSasPermissions(write=True, create=True),
            expiry=datetime.utcnow() + timedelta(minutes=10),
        )
        blob_url   = f"https://{account}.blob.core.windows.net/{container}/{blob_name}"
        upload_url = f"{blob_url}?{sas}"
        return func.HttpResponse(json.dumps({"blobUrl": blob_url, "uploadUrl": upload_url}),
                                 mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)

@app.route(route="receipts/list", methods=["GET"])
def list_receipts(req: func.HttpRequest) -> func.HttpResponse:
    """List receipt blob names for a given taskId."""
    try:
        account   = os.environ["STG_ACCOUNT"]
        key       = os.environ["STG_KEY"]
        container = os.environ.get("STG_CONTAINER", "receipts")
        task_id   = req.params.get("taskId")
        if not task_id:
            return func.HttpResponse(json.dumps({"error":"taskId required"}),
                                     mimetype="application/json", status_code=400)
        svc = BlobServiceClient(account_url=f"https://{account}.blob.core.windows.net", credential=key)
        cont = svc.get_container_client(container)
        items = [b.name for b in cont.list_blobs(name_starts_with=f"{task_id}/")]
        return func.HttpResponse(json.dumps({"files": items}), mimetype="application/json", status_code=200)
    except Exception as e:
        return func.HttpResponse(json.dumps({"error": str(e)}), mimetype="application/json", status_code=500)
