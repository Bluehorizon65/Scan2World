from pydantic import BaseModel

from s2w_common.app import create_app

from .inspect import inspect
from .mesh import mesh_from_cloud

app = create_app("geometry")


class KeyRequest(BaseModel):
    key: str


class MeshRequest(BaseModel):
    sourceKey: str
    outputPrefix: str
    dense: bool = False


@app.post("/inspect")
def inspect_route(req: KeyRequest):
    return inspect(req.key)


@app.post("/mesh")
def mesh_route(req: MeshRequest):
    return mesh_from_cloud(req.sourceKey, req.outputPrefix, req.dense)
