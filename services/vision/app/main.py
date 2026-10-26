from pydantic import BaseModel, Field

from s2w_common.app import create_app

from .analyze import DatasetReport, ImageReport, analyze_dataset

app = create_app("vision")


class AnalyzeRequest(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=1000)


class AnalyzeResponse(BaseModel):
    images: list[ImageReport]
    dataset: DatasetReport


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    images, dataset = analyze_dataset(req.keys)
    return AnalyzeResponse(images=images, dataset=dataset)
