from pydantic import BaseModel

from s2w_common.app import create_app

from .export import ExportRequest, export
from .gamemap import GamemapRequest, gamemap
from .inspect import inspect
from .mesh import mesh_from_cloud
from .process import ProcessRequest, process

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


@app.post("/process")
def process_route(req: ProcessRequest):
    return process(req)


@app.post("/gamemap")
def gamemap_route(req: GamemapRequest):
    return gamemap(req)


@app.post("/export")
def export_route(req: ExportRequest):
    return export(req)
