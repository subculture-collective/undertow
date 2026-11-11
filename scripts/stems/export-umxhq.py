# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#   "torch==2.15.0",
#   "torchaudio",
#   "openunmix==1.3.0",
#   "onnx==1.23.2",
#   "onnxruntime==1.31.1",
#   "numpy",
# ]
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# torchaudio = { index = "pytorch-cpu" }
# ///
"""
Builds the stem-separation model the editor downloads (see STEM_MODEL in
src/audio/stems.ts): Open-Unmix UMX-HQ, all four targets in one ONNX graph,
weights quantised to int8.

    uv run scripts/stems/export-umxhq.py public/models/umxhq-int8.onnx

UMX-HQ's weights come from the authors' Zenodo record 3370489
(https://zenodo.org/records/3370489), published under the MIT licence. The
graph takes the magnitude STFT of a stereo 44.1 kHz mix, shape
(1, 2, 2049, frames) with n_fft 4096 and hop 1024, as input "mag" and returns
each target's magnitude estimate, shape (4, 2, 2049, frames), as output "est",
in the order drums, bass, other, vocals.

Two runs with the pinned versions produced the same bytes (SHA-256 below).
"""
import hashlib
import inspect
import sys
import tempfile
import textwrap
import urllib.request
from pathlib import Path

import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.shape_inference import quant_pre_process
from openunmix import model as umx_model
from openunmix import umxhq_spec

ZENODO = "https://zenodo.org/records/3370489/files"
WEIGHTS = {  # target: (file, sha256)
    "drums": ("drums-9619578f.pth", "9619578f885c54737cb0234f9f9a4a679ee4f31438fd77fd1dbe02bb16c2da0a"),
    "bass": ("bass-8d85a5bd.pth", "8d85a5bd3f996a8867fca0e8442e077e5a3f5ec747a6112742452a8f347b39c8"),
    "other": ("other-b52fbbf7.pth", "b52fbbf76479e752bd72e02304c602ac7802aa5bfbfb9cd12054b2695d5093ab"),
    "vocals": ("vocals-b62c91ce.pth", "b62c91cedbc7a066f1778ead5b5cecb377aa3a46a31af1cce7c5c8769339d083"),
}
EXPECTED_SHA256 = "212eaaa684c8fe8c18f8666d6d05cde1ce8766d8c55d300896d28d950092691d"


def dynamic_frames():
    """OpenUnmix.forward reads its frame count through `x.data.shape`, which the
    tracer records as a constant; `x.shape` keeps the frame axis dynamic."""
    src = textwrap.dedent(inspect.getsource(umx_model.OpenUnmix.forward))
    if "x.data.shape" not in src:
        return
    ns = {}
    exec(src.replace("x.data.shape", "x.shape"), vars(umx_model), ns)
    umx_model.OpenUnmix.forward = ns["forward"]


def main(out: Path):
    dynamic_frames()
    models = umxhq_spec(targets=list(WEIGHTS), pretrained=False)
    with tempfile.TemporaryDirectory() as tmp:
        for target, (name, sha) in WEIGHTS.items():
            path = Path(tmp) / name
            urllib.request.urlretrieve(f"{ZENODO}/{name}?download=1", path)
            if hashlib.sha256(path.read_bytes()).hexdigest() != sha:
                sys.exit(f"{name}: checksum mismatch")
            models[target].load_state_dict(torch.load(path, map_location="cpu", weights_only=True), strict=False)
            models[target].eval()

        class FourTargets(torch.nn.Module):
            def __init__(self):
                super().__init__()
                # The attribute name ends up in the graph's weight names, so it is part of the checksum.
                self.m = torch.nn.ModuleList(models[t] for t in WEIGHTS)

            def forward(self, mag):
                return torch.cat([m(mag) for m in self.m], 0)

        fp32 = Path(tmp) / "umxhq.onnx"
        pre = Path(tmp) / "umxhq.pre.onnx"
        torch.onnx.export(
            FourTargets().eval(), (torch.rand(1, 2, 2049, 256),), str(fp32),
            input_names=["mag"], output_names=["est"],
            dynamic_axes={"mag": {3: "frames"}, "est": {3: "frames"}},
            opset_version=17, dynamo=False,
        )
        quant_pre_process(str(fp32), str(pre), skip_symbolic_shape=True)
        out.parent.mkdir(parents=True, exist_ok=True)
        quantize_dynamic(str(pre), str(out), weight_type=QuantType.QInt8)

    data = out.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    print(f"{out}: {len(data)} bytes, sha256 {sha}")
    if sha != EXPECTED_SHA256:
        print("note: differs from the checksum in STEM_MODEL; update src/audio/stems.ts if you ship this file")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "public/models/umxhq-int8.onnx"))
