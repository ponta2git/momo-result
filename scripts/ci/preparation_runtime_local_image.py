"""Pure verification of a downloaded Runtime archive and root-captured Docker export.

This module opens files only. It never invokes Docker, a shell, a network client,
a database, or a provider. Candidate provenance is checked by the caller against
the dedicated workflow contract before calling verify_local_image.
"""
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile
import zipfile


DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
HASH = re.compile(r"[0-9a-f]{64}")
MAX_ENTRIES = 4096
MAX_TOTAL_BYTES = 16 * 1024**3
MAX_METADATA_BYTES = 2 * 1024**2
MAX_LAYER_BYTES = 8 * 1024**3
ARTIFACT_FILES = {
    "candidate.json", "source-manifest.json", "rootfs-layers.json", "http4s-patch.json",
    "normal-smoke.json", "frozen-smoke.json", "momo-result-image.tar.gz",
}
CONFIG_MEDIA = {
    "application/vnd.oci.image.config.v1+json",
    "application/vnd.docker.container.image.v1+json",
}
PLAIN_LAYER_MEDIA = {
    "application/vnd.oci.image.layer.v1.tar",
    "application/vnd.docker.image.rootfs.diff.tar",
}
GZIP_LAYER_MEDIA = {
    "application/vnd.oci.image.layer.v1.tar+gzip",
    "application/vnd.docker.image.rootfs.diff.tar.gzip",
}


class Rejected(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Rejected(code)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def private_regular_file(value):
    import os
    path = Path(value)
    require(path.is_absolute() and path.resolve() == path, "REAL_ABSOLUTE_FILE_REQUIRED")
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink()
            and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
            "PRIVATE_OWNED_FILE_REQUIRED")
    return path


def file_sha256(value):
    result = hashlib.sha256()
    with private_regular_file(value).open("rb") as source:
        for chunk in iter(lambda: source.read(1024**2), b""):
            result.update(chunk)
    return result.hexdigest()


def verify_candidate_zip(zip_path, zip_sha256, image_directory):
    path = private_regular_file(zip_path)
    directory = Path(image_directory)
    require(directory.is_absolute() and directory.resolve() == directory
            and directory.is_dir() and not directory.is_symlink(), "REAL_IMAGE_DIRECTORY_REQUIRED")
    require(HASH.fullmatch(zip_sha256 or "") and file_sha256(path) == zip_sha256,
            "CANDIDATE_ZIP_CHECKSUM_MISMATCH")
    require({p.name for p in directory.iterdir()} == ARTIFACT_FILES, "EXACT_ARTIFACT_FILE_SET_REQUIRED")
    values = {}
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        require(len(entries) == len(ARTIFACT_FILES)
                and {item.filename for item in entries} == ARTIFACT_FILES,
                "EXACT_ZIP_FILE_SET_REQUIRED")
        require(sum(item.file_size for item in entries) <= MAX_TOTAL_BYTES, "ZIP_EXPANSION_LIMIT")
        for entry in entries:
            mode = entry.external_attr >> 16
            require(not entry.is_dir() and stat.S_IFMT(mode) in (0, stat.S_IFREG), "UNSAFE_ZIP_ENTRY")
            actual = private_regular_file(directory / entry.filename)
            require(actual.stat().st_size == entry.file_size, "EXTRACTED_ZIP_MEMBER_SIZE_CHANGED")
            member_hash = hashlib.sha256()
            with archive.open(entry) as source:
                for chunk in iter(lambda: source.read(1024**2), b""):
                    member_hash.update(chunk)
            require(member_hash.hexdigest() == file_sha256(actual), "EXTRACTED_ZIP_MEMBER_BYTES_CHANGED")
            values[entry.filename] = {"path": str(actual), "sha256": member_hash.hexdigest(), "bytes": entry.file_size}
    require(file_sha256(path) == zip_sha256, "CANDIDATE_ZIP_CHANGED_DURING_VERIFICATION")
    return values


def safe_member(name):
    return (isinstance(name, str) and bool(name) and not PurePosixPath(name).is_absolute()
            and ".." not in PurePosixPath(name).parts and "\\" not in name)


def indexed_tar(archive):
    members = archive.getmembers()
    require(0 < len(members) <= MAX_ENTRIES and len({m.name for m in members}) == len(members),
            "UNIQUE_BOUNDED_ARCHIVE_ENTRIES_REQUIRED")
    require(sum(m.size for m in members) <= MAX_TOTAL_BYTES, "ARCHIVE_EXPANSION_LIMIT")
    require(all(safe_member(m.name) and (m.isfile() or m.isdir()) for m in members),
            "UNSAFE_ARCHIVE_ENTRY")
    return {m.name: m for m in members}


def member_bytes(archive, members, name):
    require(safe_member(name), "SAFE_METADATA_NAME_REQUIRED")
    entry = members.get(name)
    require(entry is not None and entry.isfile() and 0 < entry.size <= MAX_METADATA_BYTES,
            "BOUNDED_METADATA_FILE_REQUIRED")
    with archive.extractfile(entry) as source:
        return source.read()


def manifest_record(archive, members, expected_ref):
    value = json.loads(member_bytes(archive, members, "manifest.json"))
    require(isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict),
            "SINGLE_DOCKER_ARCHIVE_IMAGE_REQUIRED")
    record = value[0]
    require(record.get("RepoTags") == [expected_ref] and safe_member(record.get("Config"))
            and isinstance(record.get("Layers"), list) and 0 < len(record["Layers"]) <= 150
            and all(safe_member(x) for x in record["Layers"]), "EXACT_ARCHIVE_IMAGE_REFERENCE_REQUIRED")
    return record


def config_metadata(raw, expected_id):
    require(DIGEST.fullmatch(expected_id or "") and "sha256:" + sha256(raw) == expected_id,
            "PRODUCER_CONFIG_BYTES_MISMATCH")
    config = json.loads(raw)
    layers = config.get("rootfs", {}).get("diff_ids")
    require(config.get("os") == "linux" and config.get("architecture") == "amd64"
            and config.get("rootfs", {}).get("type") == "layers"
            and isinstance(layers, list) and 0 < len(layers) <= 150
            and all(DIGEST.fullmatch(x or "") for x in layers),
            "LINUX_AMD64_ROOTFS_CONFIG_REQUIRED")
    require(isinstance(config.get("config"), dict), "IMAGE_RUNTIME_CONFIG_REQUIRED")
    return config


def layer_hashes(archive, entry, compressed=None):
    require(entry is not None and entry.isfile() and 0 < entry.size <= MAX_LAYER_BYTES,
            "BOUNDED_LAYER_FILE_REQUIRED")
    with archive.extractfile(entry) as source:
        marker = source.read(2)
    is_gzip = marker == b"\x1f\x8b"
    if compressed is not None:
        require(is_gzip == compressed, "LAYER_MEDIA_ENCODING_MISMATCH")
    raw_hash = hashlib.sha256()
    with archive.extractfile(entry) as source:
        for chunk in iter(lambda: source.read(1024**2), b""):
            raw_hash.update(chunk)
    if not is_gzip:
        return "sha256:" + raw_hash.hexdigest(), "sha256:" + raw_hash.hexdigest()
    expanded_hash = hashlib.sha256()
    total = 0
    with archive.extractfile(entry) as source, gzip.GzipFile(fileobj=source) as expanded:
        for chunk in iter(lambda: expanded.read(1024**2), b""):
            total += len(chunk)
            require(total <= MAX_LAYER_BYTES, "LAYER_EXPANSION_LIMIT")
            expanded_hash.update(chunk)
    return "sha256:" + raw_hash.hexdigest(), "sha256:" + expanded_hash.hexdigest()


def inspect_identity(value, producer_config, expected_ref):
    require(isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict),
            "SINGLE_LOCAL_INSPECT_REQUIRED")
    observed = value[0]
    local_id = observed.get("Id")
    require(isinstance(local_id, str) and DIGEST.fullmatch(local_id), "ACTUAL_LOCAL_IMAGE_ID_REQUIRED")
    require(observed.get("Architecture") == "amd64" and observed.get("Os") == "linux"
            and observed.get("RootFS", {}).get("Type") == "layers"
            and observed.get("RootFS", {}).get("Layers") == producer_config["rootfs"]["diff_ids"]
            and expected_ref in (observed.get("RepoTags") or []), "LOADED_RUNTIME_IDENTITY_MISMATCH")
    require((observed.get("Config", {}).get("Labels") or {})
            == (producer_config["config"].get("Labels") or {}), "LOCAL_IMAGE_LABELS_MISMATCH")
    return observed


def inspect_metadata(value, producer_config, producer_raw, manifest_raw, expected_ref):
    observed = inspect_identity(value, producer_config, expected_ref)
    require("sha256:" + sha256(manifest_raw) == observed["Id"], "ACTUAL_LOCAL_MANIFEST_ID_REQUIRED")
    manifest = json.loads(manifest_raw)
    descriptor = manifest.get("config", {})
    layers = manifest.get("layers")
    require(manifest.get("schemaVersion") == 2
            and manifest.get("mediaType") in {
                "application/vnd.oci.image.manifest.v1+json",
                "application/vnd.docker.distribution.manifest.v2+json"}
            and descriptor.get("mediaType") in CONFIG_MEDIA
            and descriptor.get("digest") == "sha256:" + sha256(producer_raw)
            and type(descriptor.get("size")) is int and descriptor["size"] == len(producer_raw)
            and isinstance(layers, list)
            and len(layers) == len(producer_config["rootfs"]["diff_ids"]),
            "LOCAL_MANIFEST_CONFIG_AND_LAYER_COUNT_MISMATCH")
    for layer in layers:
        require(isinstance(layer, dict) and DIGEST.fullmatch(layer.get("digest", ""))
                and layer.get("mediaType") in PLAIN_LAYER_MEDIA | GZIP_LAYER_MEDIA
                and type(layer.get("size")) is int and 0 < layer["size"] <= MAX_LAYER_BYTES,
                "LOCAL_LAYER_DESCRIPTOR_REQUIRED")
    return observed, manifest


def verify_local_image(expected, inspect_path, export_path):
    """Return observed identity, after checking both archives and all actual layers.

    expected is produced only after the dedicated candidate contract is validated:
    imageRef, producerConfigImageId, rootfsDigest, archivePath, archiveSha256. This function makes
    no claim about CI success, deployment, database readiness, or source provenance.
    """
    require(isinstance(expected, dict) and set(expected) == {
        "imageRef", "producerConfigImageId", "rootfsDigest", "archivePath", "archiveSha256"},
        "EXACT_EXPECTED_IMAGE_CONTRACT_REQUIRED")
    require(isinstance(expected["imageRef"], str) and expected["imageRef"]
            and HASH.fullmatch(expected["archiveSha256"] or "")
            and HASH.fullmatch(expected["rootfsDigest"] or ""), "EXPECTED_IMAGE_IDENTITY_REQUIRED")
    source_path = private_regular_file(expected["archivePath"])
    inspect_path = private_regular_file(inspect_path)
    export_path = private_regular_file(export_path)
    require(len({source_path, inspect_path, export_path}) == 3, "DISTINCT_CAPTURE_FILES_REQUIRED")
    initial = {str(p): file_sha256(p) for p in (source_path, inspect_path, export_path)}
    require(initial[str(source_path)] == expected["archiveSha256"], "CANDIDATE_ARCHIVE_CHECKSUM_MISMATCH")
    require(inspect_path.stat().st_size <= MAX_METADATA_BYTES, "BOUNDED_INSPECT_REQUIRED")
    observed_json = json.loads(inspect_path.read_bytes())
    with tarfile.open(source_path, mode="r:gz") as source:
        entries = indexed_tar(source)
        record = manifest_record(source, entries, expected["imageRef"])
        config_raw = member_bytes(source, entries, record["Config"])
        config = config_metadata(config_raw, expected["producerConfigImageId"])
        require(sha256(json.dumps(config["rootfs"]["diff_ids"], separators=(",", ":")).encode())
                == expected["rootfsDigest"], "CANDIDATE_ROOTFS_DIGEST_MISMATCH")
        require(len(record["Layers"]) == len(config["rootfs"]["diff_ids"]),
                "CANDIDATE_LAYER_COUNT_MISMATCH")
        for path, wanted in zip(record["Layers"], config["rootfs"]["diff_ids"], strict=True):
            _, actual_diff = layer_hashes(source, entries.get(path))
            require(actual_diff == wanted, "CANDIDATE_LAYER_CONTENT_MISMATCH")
    require(isinstance(observed_json, list) and len(observed_json) == 1
            and DIGEST.fullmatch(observed_json[0].get("Id", "")), "SINGLE_LOCAL_INSPECT_REQUIRED")
    actual_local_id = observed_json[0]["Id"]
    identity_kind = "producer-config-digest" if actual_local_id == expected["producerConfigImageId"] else "oci-manifest-digest"
    manifest_raw = None
    local_layer_digests = []
    with tarfile.open(export_path, mode="r:") as exported:
        entries = indexed_tar(exported)
        record = manifest_record(exported, entries, expected["imageRef"])
        local_config_raw = member_bytes(exported, entries, record["Config"])
        require(local_config_raw == config_raw, "EXPORTED_CONFIG_BYTES_MISMATCH")
        inspect_identity(observed_json, config, expected["imageRef"])
        require(len(record["Layers"]) == len(config["rootfs"]["diff_ids"]), "LOCAL_LAYER_COUNT_MISMATCH")
        if identity_kind == "oci-manifest-digest":
            manifest_raw = member_bytes(exported, entries, "blobs/sha256/" + actual_local_id[7:])
            _, manifest = inspect_metadata(observed_json, config, config_raw, manifest_raw, expected["imageRef"])
            expected_layer_paths = ["blobs/sha256/" + d["digest"][7:] for d in manifest["layers"]]
            require(record["Layers"] == expected_layer_paths, "DOCKER_AND_OCI_LAYER_ORDER_MISMATCH")
            for descriptor, path, wanted_diff in zip(manifest["layers"], expected_layer_paths,
                    config["rootfs"]["diff_ids"], strict=True):
                entry = entries.get(path)
                require(entry is not None and entry.size == descriptor["size"], "LOCAL_LAYER_SIZE_MISMATCH")
                actual_raw, actual_diff = layer_hashes(exported, entry, descriptor["mediaType"] in GZIP_LAYER_MEDIA)
                require(actual_raw == descriptor["digest"] and actual_diff == wanted_diff,
                        "LOCAL_LAYER_CONTENT_MISMATCH")
                local_layer_digests.append(actual_raw)
        else:
            # Docker's classic store identifies an image by the config digest.
            # The config bytes and every exported layer's diffID still have to
            # equal the authenticated producer archive; no synthetic OCI ID.
            for path, wanted_diff in zip(record["Layers"], config["rootfs"]["diff_ids"], strict=True):
                actual_raw, actual_diff = layer_hashes(exported, entries.get(path))
                require(actual_diff == wanted_diff, "LOCAL_LAYER_CONTENT_MISMATCH")
                local_layer_digests.append(actual_raw)
    require(initial == {str(p): file_sha256(p) for p in (source_path, inspect_path, export_path)},
            "IMAGE_EVIDENCE_CHANGED_DURING_VERIFICATION")
    return {
        "actualDockerImageId": actual_local_id,
        "producerConfigImageId": expected["producerConfigImageId"],
        "imageRef": expected["imageRef"], "os": "linux", "architecture": "amd64",
        "localIdentityKind": identity_kind,
        "localManifestSha256": sha256(manifest_raw) if manifest_raw is not None else None,
        "localManifestConfigDigest": expected["producerConfigImageId"],
        "localManifestLayerDigests": local_layer_digests,
        "producerRootfsDiffIds": config["rootfs"]["diff_ids"],
        "rootfsDigest": expected["rootfsDigest"],
        "bakedLabels": config["config"].get("Labels") or {},
        "localRunnableIdVerified": True, "exportedLocalConfigBytesEqualProducerArchive": True,
        "rootfsDiffIdsEqualProducerArchive": True, "allCandidateLayerBytesVerified": True,
        "allExportedLayerBytesVerified": True,
        "inputFileSha256": initial,
        "dockerExecutedByVerifier": False, "containersCreatedByVerifier": False,
        "databaseConnectionsOpened": False, "productionChangesMade": False,
        "deploymentEvidence": False, "finalEvidence": False,
    }
