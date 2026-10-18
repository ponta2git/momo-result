#!/usr/bin/env python3
"""Verify the fixed repair artifact without extracting Docker archive paths."""
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tarfile
import zipfile
import zlib
from preparation_runtime_local_image import (
    config_metadata, indexed_tar, manifest_record, member_bytes, sha256, verify_local_image,
)

FILES = {
    "candidate.json", "source-manifest.json", "rootfs-layers.json",
    "http4s-patch.json", "normal-smoke.json", "frozen-smoke.json",
    "momo-result-image.tar.gz",
}
LIMIT = 12 * 1024 * 1024 * 1024


def require(condition):
    if not condition:
        raise ValueError("REPAIR_ARCHIVE_INVALID")


def valid_path(name):
    path = PurePosixPath(name)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in name)
    require(name == str(path) and len(name) <= 300)


def extract_zip(source, destination):
    destination = Path(destination)
    destination.mkdir(mode=0o700)
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        require(len(entries) == len(FILES) and {item.filename for item in entries} == FILES)
        require(sum(item.file_size for item in entries) <= LIMIT)
        for item in entries:
            mode = item.external_attr >> 16
            require(not item.is_dir() and not item.flag_bits & 1)
            require(mode == 0 or stat.S_IFMT(mode) in (0, stat.S_IFREG))
            require(item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED))
            require(item.file_size <= (LIMIT if item.filename.endswith(".tar.gz") else 65536))
            path = destination / item.filename
            with archive.open(item) as reader, path.open("xb") as writer:
                path.chmod(0o600)
                while chunk := reader.read(1024 * 1024):
                    writer.write(chunk)


def verify_tar(directory):
    directory = Path(directory)
    candidate = json.loads((directory / "candidate.json").read_bytes())
    expected_layers = json.loads((directory / "rootfs-layers.json").read_bytes())
    expected_tag = "registry.fly.io/momo-result:{sourceSha}-{runId}-{runAttempt}".format(**candidate)
    hashes, diff_hashes, small = {}, {}, {}
    total = 0
    with gzip.open(directory / "momo-result-image.tar.gz", "rb") as compressed:
        with tarfile.open(fileobj=compressed, mode="r|") as archive:
            for entry in archive:
                valid_path(entry.name.rstrip("/") if entry.isdir() else entry.name)
                require(entry.name not in hashes and not entry.issym() and not entry.islnk())
                if entry.isdir():
                    continue
                require(entry.isfile() and 0 <= entry.size <= LIMIT)
                total += entry.size
                require(total <= LIMIT and len(hashes) < 10000)
                raw, expanded = hashlib.sha256(), hashlib.sha256()
                captured = bytearray() if entry.size <= 1024 * 1024 else None
                count = expanded_count = 0
                inflater = None
                stream = archive.extractfile(entry)
                while chunk := stream.read(1024 * 1024):
                    if count == 0 and chunk[:2] == b"\x1f\x8b":
                        inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
                    count += len(chunk)
                    raw.update(chunk)
                    if captured is not None:
                        captured.extend(chunk)
                    if inflater is None:
                        expanded.update(chunk)
                    else:
                        remaining = chunk
                        while remaining:
                            output = inflater.decompress(remaining, 1024 * 1024)
                            expanded_count += len(output)
                            require(expanded_count <= LIMIT)
                            expanded.update(output)
                            remaining = inflater.unconsumed_tail
                        require(not inflater.unused_data)
                require(count == entry.size)
                if inflater is not None:
                    output = inflater.flush()
                    expanded_count += len(output)
                    require(expanded_count <= LIMIT and inflater.eof and not inflater.unused_data)
                    expanded.update(output)
                hashes[entry.name] = "sha256:" + raw.hexdigest()
                diff_hashes[entry.name] = "sha256:" + expanded.hexdigest()
                if captured is not None:
                    small[entry.name] = bytes(captured)
        # Reading to EOF validates the outer gzip CRC even when tar ended first.
        while compressed.read(1024 * 1024):
            pass
    manifest = json.loads(small["manifest.json"])
    require(isinstance(manifest, list) and len(manifest) == 1)
    manifest = manifest[0]
    require(manifest["RepoTags"] == [expected_tag])
    config_path = manifest["Config"]
    valid_path(config_path)
    require(hashes[config_path] == candidate["configDigest"])
    config = json.loads(small[config_path])
    require(config["os"] == "linux" and config["architecture"] == "amd64")
    require(config["rootfs"]["type"] == "layers" and config["rootfs"]["diff_ids"] == expected_layers)
    require(hashlib.sha256(json.dumps(expected_layers, separators=(",", ":")).encode()).hexdigest()
            == candidate["rootfsDigest"])
    layers = manifest["Layers"]
    require(isinstance(layers, list) and len(layers) == len(expected_layers))
    for path, expected in zip(layers, expected_layers):
        valid_path(path)
        require(re.fullmatch(r"sha256:[a-f0-9]{64}", expected))
        require(diff_hashes[path] == expected)


def main():
    if len(sys.argv) == 4 and sys.argv[1] == "extract-zip":
        extract_zip(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == "verify-tar":
        verify_tar(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == "source-config":
        with tarfile.open(sys.argv[2], mode="r:gz") as source:
            entries = indexed_tar(source)
            record = manifest_record(source, entries, sys.argv[3])
            raw = member_bytes(source, entries, record["Config"])
            config_id = "sha256:" + sha256(raw)
            config = config_metadata(raw, config_id)
            print(json.dumps({"configDigest": config_id, "layers": config["rootfs"]["diff_ids"]}))
    elif len(sys.argv) == 5 and sys.argv[1] == "verify-local":
        expected = json.loads(Path(sys.argv[2]).read_bytes())
        proof = verify_local_image(expected, sys.argv[3], sys.argv[4])
        print(json.dumps({key: proof[key] for key in (
            "actualDockerImageId", "producerConfigImageId", "rootfsDigest",
            "localIdentityKind", "localRunnableIdVerified",
        )}))
    else:
        raise ValueError("REPAIR_ARCHIVE_ARGUMENTS")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("REPAIR_ARCHIVE_INVALID", file=sys.stderr)
        sys.exit(1)
