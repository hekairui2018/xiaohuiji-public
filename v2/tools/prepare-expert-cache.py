"""Prepare a reversible local Gyro expert-cache configuration; never write the live config."""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def profile_info(path):
    blob = Path(path).read_bytes()
    if len(blob) < 24 or blob[:4] != b"STRP":
        raise ValueError("Invalid expert profile")
    version, layers, experts, slots, count = struct.unpack_from("<5I", blob, 4)
    if version != 1 or not layers or not experts or count != layers * experts or slots != count:
        raise ValueError("Incomplete or incompatible expert ranking")
    if len(blob) != 24 + count * 4 + layers * experts * 4:
        raise ValueError("Invalid profile length")
    pairs = [struct.unpack_from("<HH", blob, 24 + i * 4) for i in range(count)]
    if len(set(pairs)) != count or any(layer >= layers or expert >= experts for layer, expert in pairs):
        raise ValueError("Invalid expert pairs")
    table = struct.unpack_from("<%di" % count, blob, 24 + count * 4)
    if any(table[layer * experts + expert] != rank for rank, (layer, expert) in enumerate(pairs)):
        raise ValueError("Profile lookup table disagrees with its ranking")
    return {"layers": layers, "expertsPerLayer": experts, "rankedPairs": count,
            "sha256": hashlib.sha256(blob).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--learned-profile", required=True)
    parser.add_argument("--reserve-mib", type=int, default=1024)
    args = parser.parse_args()
    if args.reserve_mib < 768:
        raise ValueError("Keep at least 768 MiB for the desktop and runtime headroom")
    original = Path(args.config).read_bytes()
    config = json.loads(original.decode("utf-8-sig"))
    if "gyro" not in config.get("model_name", "").lower():
        raise ValueError("This plan requires a Gyro model")
    argv = config["args"]
    base = profile_info(argv[argv.index("--expert-profile") + 1])
    index = argv.index("--vram-reserve-mib") + 1
    before = argv[index]
    argv[index] = str(args.reserve_mib)
    config["expert_profile_save"] = str(Path(args.learned_profile).resolve())
    config["expert_profile_save_every"] = 1
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "config-before.private.json").write_bytes(original)
    (out / "config-candidate.private.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    plan = {"originalSHA256": hashlib.sha256(original).hexdigest(), "profile": base,
            "reserveBeforeMiB": int(before), "reserveCandidateMiB": args.reserve_mib,
            "learnedProfileSaveEveryMinutes": 1, "liveConfigChanged": False}
    (out / "plan.private.json").write_text(json.dumps(plan, indent=2), encoding="utf-8")
    print(json.dumps(plan))


if __name__ == "__main__":
    main()
