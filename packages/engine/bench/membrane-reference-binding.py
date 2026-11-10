"""Lossless native uv-displacement descriptor binding; no physics formulas."""

import base64
import binascii
import hashlib
import json
import math
import struct

ENCODING = {
    "version": 1,
    "order": ["u[3]", "v[3]", "x0[9]", "c", "s", "Q[4]", "volume"],
    "floatsPerElement": 22,
    "nativeElementOrder": True,
}


def verify(case):
    present = [key in case for key in ("referenceFloat64LE", "referenceSHA256")]
    if any(present) and not all(present):
        raise ValueError("referenceFloat64LE/referenceSHA256 must be supplied together")
    if "referenceEncoding" in case and json.dumps(
        case["referenceEncoding"], sort_keys=True
    ) != json.dumps(ENCODING, sort_keys=True):
        raise ValueError(
            "referenceEncoding differs from the declared native22-float order"
        )
    if not any(present):
        return {
            "referenceFloat64LESHA256": None,
            "referenceLosslessSupplied": False,
            "referenceEncoding": ENCODING,
        }
    encoded, claimed = case["referenceFloat64LE"], case["referenceSHA256"]
    if not isinstance(encoded, str) or not isinstance(claimed, str):
        raise TypeError("lossless reference bytes/hash must be text")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("invalid reference base64") from error
    if base64.b64encode(raw).decode() != encoded:
        raise ValueError("reference base64 must be canonical")
    elements = case["referenceCoefficients"]["elements"]
    expected = []
    for element in elements:
        reference = element["reference"]
        for key, count in (("u", 3), ("v", 3), ("x0", 9)):
            values = reference[key]
            if not isinstance(values, list) or len(values) != count:
                raise ValueError("invalid reference vector dimensions")
            expected.extend(values)
        expected.extend([reference["c"], reference["s"]])
        if not isinstance(element["Q"], list) or len(element["Q"]) != 4:
            raise ValueError("invalid reference Q dimensions")
        expected.extend(element["Q"])
        expected.append(element["volume"])
    if len(raw) != 8 * 22 * len(elements):
        raise ValueError("referenceFloat64LE byte count mismatch")
    decoded = struct.unpack("<" + str(len(expected)) + "d", raw)
    for native, value in zip(decoded, expected):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TypeError("reference entries must be finite numbers")
        value = float(value)
        if not math.isfinite(value) or not math.isfinite(native) or value != native:
            raise ValueError("native reference bytes differ from numeric descriptor")
        # JSON.stringify loses -0. Native bytes remain authoritative. A numeric
        # -0 explicitly present in a non-JSON.stringify input must still match.
        if value == 0 and math.copysign(1, value) < 0 and math.copysign(1, native) > 0:
            raise ValueError("explicit negative-zero reference sign mismatch")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != claimed:
        raise ValueError("referenceSHA256 mismatch")
    return {
        "referenceFloat64LESHA256": digest,
        "referenceLosslessSupplied": True,
        "referenceEncoding": ENCODING,
        "referenceZeroPolicy": "native zero signs bound by raw hash; JSON numeric zeros may lose sign",
    }
