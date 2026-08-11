#!/usr/bin/env bash
set -euo pipefail

readonly version="1.7.12"
readonly destination="${1:?destination path is required}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    readonly platform="linux_amd64"
    readonly expected_sha256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
    ;;
  Linux-aarch64 | Linux-arm64)
    readonly platform="linux_arm64"
    readonly expected_sha256="325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6"
    ;;
  Darwin-x86_64)
    readonly platform="darwin_amd64"
    readonly expected_sha256="5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644"
    ;;
  Darwin-arm64)
    readonly platform="darwin_arm64"
    readonly expected_sha256="aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f"
    ;;
  *)
    echo "Unsupported actionlint platform: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
readonly archive="${tmp_dir}/actionlint.tar.gz"
readonly url="https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_${platform}.tar.gz"

curl -fsSL -o "${archive}" "${url}"
if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "${expected_sha256}" "${archive}" | sha256sum -c -
else
  actual_sha256="$(shasum -a 256 "${archive}" | awk '{print $1}')"
  [[ "${actual_sha256}" == "${expected_sha256}" ]] || {
    echo "actionlint checksum mismatch." >&2
    exit 1
  }
fi

tar -xzf "${archive}" -C "${tmp_dir}" actionlint
mkdir -p "$(dirname "${destination}")"
install -m 0755 "${tmp_dir}/actionlint" "${destination}"
"${destination}" -version
