"""Ordered, recorded mesh processing. The source asset is never modified; results go to a new key."""

import time
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from .io import load_mesh, save_mesh
from .ops import align_floor, remove_small_components, simplify


class AlignFloor(BaseModel):
    op: Literal["align_floor"]


class Scale(BaseModel):
    op: Literal["scale"]
    factor: float = Field(gt=0, le=1000)


class Simplify(BaseModel):
    op: Literal["simplify"]
    targetTriangles: int = Field(ge=100, le=10_000_000)


class RemoveSmallComponents(BaseModel):
    op: Literal["remove_small_components"]
    minFaceRatio: float = Field(default=0.01, gt=0, le=1)


Op = Annotated[AlignFloor | Scale | Simplify | RemoveSmallComponents, Field(discriminator="op")]


class ProcessRequest(BaseModel):
    sourceKey: str
    outputPrefix: str
    ops: list[Op] = Field(min_length=1, max_length=20)
    camerasKey: str | None = None


def process(req: ProcessRequest) -> dict:
    mesh = load_mesh(req.sourceKey)
    steps = []
    for op in req.ops:
        t0, before = time.monotonic(), len(mesh.faces)
        step: dict = {"op": op.op, "params": op.model_dump(exclude={"op"})}
        if isinstance(op, AlignFloor):
            mesh, info = align_floor(mesh, req.camerasKey)
            step.update(info)
        elif isinstance(op, Scale):
            mesh = mesh.copy()
            mesh.apply_scale(op.factor)
        elif isinstance(op, Simplify):
            mesh = simplify(mesh, op.targetTriangles)
        elif isinstance(op, RemoveSmallComponents):
            mesh, removed = remove_small_components(mesh, op.minFaceRatio)
            step["removedComponents"] = removed
        step.update(trianglesBefore=before, trianglesAfter=len(mesh.faces), ms=round((time.monotonic() - t0) * 1000))
        steps.append(step)
    key = save_mesh(mesh, req.outputPrefix, "processed.glb")
    return {
        "outputs": {"mesh_glb": key},
        "report": {"steps": steps, "aligned": any(s["op"] == "align_floor" for s in steps)},
    }
