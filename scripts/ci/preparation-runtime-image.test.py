"""Synthetic, file-only checks. These are never actual image or deployment evidence."""
import copy
import gzip
import io
import json
from pathlib import Path
import importlib.util
import stat
import sys
import tarfile
import tempfile
import zipfile

import preparation_runtime_local_image as v

spec = importlib.util.spec_from_file_location("repair_archive", Path(__file__).with_name("preparation-runtime-image.py"))
archive_verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive_verifier)


def encoded(value):
    return json.dumps(value, separators=(",", ":")).encode()


def fixture(compressed_source=False, compressed_local=False):
    ref = "registry.fly.io/momo-result:synthetic-repair-fixture"
    payloads = [b"alpha" * 64, b"beta" * 64]
    diff_ids = ["sha256:" + v.sha256(x) for x in payloads]
    config = {"os": "linux", "architecture": "amd64", "rootfs": {"type": "layers", "diff_ids": diff_ids},
              "config": {"Labels": {"org.opencontainers.image.revision": "1" * 40}}}
    config_raw = encoded(config)
    config_id = "sha256:" + v.sha256(config_raw)
    config_path = "blobs/sha256/" + config_id[7:]
    source_layers = [gzip.compress(x, mtime=0) if compressed_source else x for x in payloads]
    local_layers = [gzip.compress(x, mtime=0) if compressed_local else x for x in payloads]
    source_paths = ["blobs/sha256/" + v.sha256(x) for x in source_layers]
    local_paths = ["blobs/sha256/" + v.sha256(x) for x in local_layers]
    media = "application/vnd.oci.image.layer.v1.tar" + ("+gzip" if compressed_local else "")
    manifest = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "config": {"mediaType": "application/vnd.oci.image.config.v1+json", "digest": config_id,
                           "size": len(config_raw)},
                "layers": [{"mediaType": media, "digest": "sha256:" + v.sha256(x), "size": len(x)} for x in local_layers]}
    return {"ref": ref, "configId": config_id, "configPath": config_path, "config": config,
            "configRaw": config_raw, "exportedConfigRaw": config_raw,
            "sourceRecord": {"Config": config_path, "RepoTags": [ref], "Layers": source_paths},
            "localRecord": {"Config": config_path, "RepoTags": [ref], "Layers": local_paths},
            "sourceLayers": dict(zip(source_paths, source_layers)),
            "localLayers": dict(zip(local_paths, local_layers)), "manifest": manifest,
            "inspect": {"Id": None, "Os": "linux", "Architecture": "amd64", "RepoTags": [ref],
                        "RootFS": {"Type": "layers", "Layers": diff_ids}, "Config": copy.deepcopy(config["config"])},
            "expectedRootfsDigest": v.sha256(encoded(diff_ids)), "extraSource": [], "extraLocal": [],
            "alterExpected": {}}


def write_archive(path, records, mode, extras):
    with tarfile.open(path, mode=mode) as archive:
        for name, raw in records + extras:
            entry = tarfile.TarInfo(name)
            if raw is None:
                entry.type = tarfile.SYMTYPE
                entry.linkname = "outside"
                archive.addfile(entry)
            else:
                entry.size = len(raw)
                archive.addfile(entry, io.BytesIO(raw))
    path.chmod(0o600)


def verify_fixture(case):
    with tempfile.TemporaryDirectory(prefix="momo-repair-image-selfcheck-") as temp:
        root = Path(temp).resolve()
        source = root / "source.tar.gz"
        exported = root / "exported.tar"
        inspect = root / "inspect.json"
        manifest_raw = encoded(case["manifest"])
        local_id = "sha256:" + v.sha256(manifest_raw)
        case["inspect"]["Id"] = case["inspect"].get("Id") or local_id
        write_archive(source, [("manifest.json", encoded([case["sourceRecord"]])),
            (case["configPath"], case["configRaw"])] + list(case["sourceLayers"].items()), "w:gz", case["extraSource"])
        write_archive(exported, [("manifest.json", encoded([case["localRecord"]])),
            (case["configPath"], case["exportedConfigRaw"]),
            ("blobs/sha256/" + local_id[7:], manifest_raw)] + list(case["localLayers"].items()), "w:", case["extraLocal"])
        inspect.write_bytes(encoded([case["inspect"]])); inspect.chmod(0o600)
        expected = {"imageRef": case["ref"], "producerConfigImageId": case["configId"],
                    "rootfsDigest": case["expectedRootfsDigest"], "archivePath": str(source),
                    "archiveSha256": v.file_sha256(source)}
        expected.update(case["alterExpected"])
        return v.verify_local_image(expected, str(inspect), str(exported))


def reject(name, change, code):
    case = fixture()
    change(case)
    try:
        verify_fixture(case)
    except v.Rejected as error:
        assert str(error) == code, (name, str(error), code)
        return {"name": name, "result": "passed", "rejection": code}
    raise AssertionError("accepted invalid fixture: " + name)


def candidate_fixture(destination, source_manifest, compressed=False):
    root = Path(destination).resolve()
    root.mkdir(mode=0o700)
    manifest_bytes = Path(source_manifest).read_bytes()
    manifest = json.loads(manifest_bytes)
    candidate = {"formatVersion": 1, "operation": "preparation-runtime-repair",
        **{key: manifest[key] for key in ["baseSha", "patchSha", "sourceSha", "sourceTree"]},
        "sourceManifestSha256": v.sha256(manifest_bytes), "workflowSha": "b" * 40, "runId": "100", "runAttempt": 2}
    case = fixture(compressed_source=compressed)
    case["ref"] = "registry.fly.io/momo-result:{sourceSha}-{runId}-{runAttempt}".format(**candidate)
    case["sourceRecord"]["RepoTags"] = [case["ref"]]
    case["localRecord"]["RepoTags"] = [case["ref"]]
    case["inspect"]["RepoTags"] = [case["ref"]]
    archive = root / "momo-result-image.tar.gz"
    write_archive(archive, [("manifest.json", encoded([case["sourceRecord"]])),
        (case["configPath"], case["configRaw"])] + list(case["sourceLayers"].items()), "w:gz", [])
    candidate.update(archiveSha256=v.file_sha256(archive), configDigest=case["configId"],
                     rootfsDigest=case["expectedRootfsDigest"])
    files = {
        "candidate.json": encoded(candidate),
        "source-manifest.json": manifest_bytes,
        "rootfs-layers.json": encoded(case["config"]["rootfs"]["diff_ids"]),
        "http4s-patch.json": encoded({"repository": "https://github.com/ponta2git/http4s.git",
            "scalaVersion": "3.3.6", "sourceSha": manifest["http4sSourceSha"], "version": "0.0.0-fixture"}),
        "normal-smoke.json": encoded({"event": "runtime_postdeploy_smoke", "schemaVersion": 1,
            "status": "ok", "checks": ["database", "http", "http2", "processes", "web"]}),
        "frozen-smoke.json": encoded({"event": "runtime_maintenance_readiness", "schemaVersion": 1,
            "status": "ok", "checks": ["frozen_readiness", "normal_routes_closed", "database_contract", "runtime_processes"],
            "database": {"formatVersion": 1, "targetFingerprint": "c" * 64, "ledgerFingerprint": "d" * 64}}),
    }
    for name, data in files.items():
        path = root / name
        path.write_bytes(data)
        path.chmod(0o600)
    return candidate, case


def local_captures(destination, case):
    root = Path(destination).resolve()
    root.mkdir(mode=0o700)
    raw = encoded(case["manifest"])
    actual_id = "sha256:" + v.sha256(raw)
    case["inspect"]["Id"] = actual_id
    write_archive(root / "export.tar", [("manifest.json", encoded([case["localRecord"]])),
        (case["configPath"], case["exportedConfigRaw"]),
        ("blobs/sha256/" + actual_id[7:], raw)] + list(case["localLayers"].items()), "w:", [])
    (root / "inspect.json").write_bytes(encoded([case["inspect"]]))
    (root / "inspect.json").chmod(0o600)


def archive_checks():
    count = 0
    source_manifest = Path(__file__).with_name("preparation-runtime-repair-source.json")
    with tempfile.TemporaryDirectory(prefix="momo-repair-archive-selfcheck-") as temp:
        parent = Path(temp).resolve()
        for compressed in [False, True]:
            directory = parent / ("gzip" if compressed else "plain")
            candidate, case = candidate_fixture(directory, source_manifest, compressed)
            archive_verifier.verify_tar(directory)
            count += 1
        directory = parent / "plain"
        candidate, case = json.loads((directory / "candidate.json").read_bytes()), fixture()
        for key in ["configDigest", "rootfsDigest"]:
            changed = copy.deepcopy(candidate)
            changed[key] = ("sha256:" if key == "configDigest" else "") + "0" * 64
            (directory / "candidate.json").write_bytes(encoded(changed))
            try:
                archive_verifier.verify_tar(directory)
            except ValueError:
                count += 1
            else:
                raise AssertionError("accepted changed " + key)
        (directory / "candidate.json").write_bytes(encoded(candidate))
        archive = parent / "valid.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for path in directory.iterdir():
                target.write(path, path.name)
        archive_verifier.extract_zip(archive, parent / "extracted")
        assert {p.name for p in (parent / "extracted").iterdir()} == v.ARTIFACT_FILES
        count += 1
        for mode in ["extra", "symlink", "duplicate", "traversal"]:
            bad = parent / (mode + ".zip")
            with zipfile.ZipFile(bad, "w") as target:
                for path in directory.iterdir():
                    if mode == "symlink" and path.name == "candidate.json":
                        entry = zipfile.ZipInfo(path.name)
                        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                        target.writestr(entry, b"outside")
                    elif mode == "traversal" and path.name == "candidate.json":
                        target.writestr("../candidate.json", path.read_bytes())
                    else:
                        target.write(path, path.name)
                if mode == "extra":
                    target.writestr("private.json", b"private-canary")
                elif mode == "duplicate":
                    import warnings
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", UserWarning)
                        target.writestr("candidate.json", b"{}")
            try:
                archive_verifier.extract_zip(bad, parent / ("reject-" + mode))
            except ValueError:
                count += 1
            else:
                raise AssertionError("accepted unsafe ZIP " + mode)
    return count


def main():
    checks = []
    for source_compressed, local_compressed in [(False, False), (True, True), (True, False), (False, True)]:
        result = verify_fixture(fixture(source_compressed, local_compressed))
        assert result["actualDockerImageId"] != result["producerConfigImageId"]
        assert result["allCandidateLayerBytesVerified"] and result["allExportedLayerBytesVerified"]
        assert result["deploymentEvidence"] is False and result["dockerExecutedByVerifier"] is False
        checks.append({"name": f"valid sourceGzip={source_compressed} localGzip={local_compressed}", "result": "passed"})
    for compressed in [False, True]:
        case = fixture(False, compressed)
        case["inspect"]["Id"] = case["configId"]
        result = verify_fixture(case)
        assert result["actualDockerImageId"] == result["producerConfigImageId"]
        assert result["localIdentityKind"] == "producer-config-digest" and result["localManifestSha256"] is None
        assert result["allExportedLayerBytesVerified"]
        checks.append({"name": f"valid classic Docker localGzip={compressed}", "result": "passed"})
    invalid = [
        ("candidate archive checksum", lambda x: x["alterExpected"].update(archiveSha256="0" * 64), "CANDIDATE_ARCHIVE_CHECKSUM_MISMATCH"),
        ("candidate config ID", lambda x: x["alterExpected"].update(producerConfigImageId="sha256:" + "0" * 64), "PRODUCER_CONFIG_BYTES_MISMATCH"),
        ("candidate rootfs digest", lambda x: x.update(expectedRootfsDigest="0" * 64), "CANDIDATE_ROOTFS_DIGEST_MISMATCH"),
        ("source layer bytes", lambda x: x["sourceLayers"].__setitem__(next(iter(x["sourceLayers"])), b"changed"), "CANDIDATE_LAYER_CONTENT_MISMATCH"),
        ("source tag", lambda x: x["sourceRecord"].update(RepoTags=["wrong"]), "EXACT_ARCHIVE_IMAGE_REFERENCE_REQUIRED"),
        ("source layer order", lambda x: x["sourceRecord"]["Layers"].reverse(), "CANDIDATE_LAYER_CONTENT_MISMATCH"),
        ("source duplicate entry", lambda x: x["extraSource"].append(("manifest.json", b"[]")), "UNIQUE_BOUNDED_ARCHIVE_ENTRIES_REQUIRED"),
        ("source symlink", lambda x: x["extraSource"].append(("link", None)), "UNSAFE_ARCHIVE_ENTRY"),
        ("source traversal", lambda x: x["extraSource"].append(("../outside", b"x")), "UNSAFE_ARCHIVE_ENTRY"),
        ("exported config bytes", lambda x: x.update(exportedConfigRaw=x["configRaw"] + b" "), "EXPORTED_CONFIG_BYTES_MISMATCH"),
        ("inspect rootfs", lambda x: x["inspect"]["RootFS"].update(Layers=["sha256:" + "0" * 64]), "LOADED_RUNTIME_IDENTITY_MISMATCH"),
        ("inspect platform", lambda x: x["inspect"].update(Architecture="arm64"), "LOADED_RUNTIME_IDENTITY_MISMATCH"),
        ("inspect candidate tag", lambda x: x["inspect"].update(RepoTags=["wrong"]), "LOADED_RUNTIME_IDENTITY_MISMATCH"),
        ("inspect labels", lambda x: x["inspect"]["Config"].update(Labels={"unrelated": "yes"}), "LOCAL_IMAGE_LABELS_MISMATCH"),
        ("local manifest config", lambda x: x["manifest"]["config"].update(digest="sha256:" + "0" * 64), "LOCAL_MANIFEST_CONFIG_AND_LAYER_COUNT_MISMATCH"),
        ("local manifest config size", lambda x: x["manifest"]["config"].update(size=1), "LOCAL_MANIFEST_CONFIG_AND_LAYER_COUNT_MISMATCH"),
        ("local layer order", lambda x: x["localRecord"]["Layers"].reverse(), "DOCKER_AND_OCI_LAYER_ORDER_MISMATCH"),
        ("local layer size", lambda x: x["manifest"]["layers"][0].update(size=1), "LOCAL_LAYER_SIZE_MISMATCH"),
        ("local layer bytes", lambda x: x["localLayers"].__setitem__(next(iter(x["localLayers"])), b"ALPHA" * 64), "LOCAL_LAYER_CONTENT_MISMATCH"),
        ("local layer encoding", lambda x: x["manifest"]["layers"][0].update(mediaType="application/vnd.oci.image.layer.v1.tar+gzip"), "LAYER_MEDIA_ENCODING_MISMATCH"),
    ]
    for name, change, code in invalid:
        checks.append(reject(name, change, code))
    print(json.dumps({"kind": "synthetic-preparation-runtime-image-checks",
        "passed": len(checks) + archive_checks(), "actualImagesVerified": 0,
        "dockerExecuted": False, "databaseConnectionsOpened": False}))


if __name__ == "__main__":
    if len(sys.argv) in [4, 5] and sys.argv[1] == "--fixture":
        candidate, case = candidate_fixture(sys.argv[2], sys.argv[3])
        if len(sys.argv) == 5:
            local_captures(sys.argv[4], case)
    else:
        main()
