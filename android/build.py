#!/usr/bin/env python3
"""Build an offline APK with official Android SDK tools; no Gradle dependencies."""
from pathlib import Path
import hashlib
import os
import platform
import secrets
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / "android"
BUILD = ANDROID / "build"
SDK = Path(os.environ.get("MOON_ANDROID_SDK") or os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ROOT.parent / "moon-android-sdk").resolve()
VERSION = "2.0.1"
VERSION_CODE = 2


def run(*args, cwd=ROOT):
    subprocess.run([str(arg) for arg in args], cwd=cwd, check=True)


def sha1(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha1").hexdigest()


def sdk_package(filename, checksum, destination, archive_root):
    if destination.is_dir():
        return
    cache = Path(os.environ.get("MOON_ANDROID_DOWNLOADS", tempfile.gettempdir())) / "moon-sdk-cache"
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / filename
    if not archive.exists() or sha1(archive) != checksum:
        print(f"Downloading official SDK package: {filename}", flush=True)
        urllib.request.urlretrieve("https://dl.google.com/android/repository/" + filename, archive)
    if sha1(archive) != checksum:
        raise RuntimeError(f"Official SDK checksum mismatch: {filename}")
    with tempfile.TemporaryDirectory(dir=SDK) as folder:
        unpacked = Path(folder)
        with zipfile.ZipFile(archive) as zipped:
            for entry in zipped.infolist():
                target = (unpacked / entry.filename).resolve()
                if not target.is_relative_to(unpacked.resolve()):
                    raise RuntimeError("Invalid SDK archive path")
                zipped.extract(entry, unpacked)
                if not entry.is_dir():
                    mode = entry.external_attr >> 16
                    if mode:
                        target.chmod(mode & 0o777)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(unpacked / archive_root), destination)


def main():
    if platform.system() != "Linux":
        raise RuntimeError("This reproducible build script currently requires Linux.")
    SDK.mkdir(parents=True, exist_ok=True)
    android_jar = SDK / "platforms/android-35/android.jar"
    tools = SDK / "build-tools/35.0.0"
    sdk_package("platform-35_r02.zip", "0bb560a90a7a2cbd0dd8348224d518b638fe7949", android_jar.parent, "android-35")
    sdk_package("build-tools_r35_linux.zip", "2cfaa0bbb2336e9ec18ed3ecea84fa2e2af607bc", tools, "android-15")
    run("java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-version")
    run("npm", "run", "build")
    if BUILD.exists():
        shutil.rmtree(BUILD)
    for name in ["classes", "dex", "resources", "assets/src"]:
        (BUILD / name).mkdir(parents=True)
    for name in ["index.html", "style.css", "src/app.js", "src/physics.js", "src/game.js"]:
        shutil.copyfile(ROOT / "dist" / name, BUILD / "assets" / name)
    run(tools / "aapt2", "compile", "--dir", ANDROID / "res", "-o", BUILD / "resources.zip")
    run(tools / "aapt2", "link", "-o", BUILD / "unsigned.apk", "-I", android_jar,
        "--manifest", ANDROID / "AndroidManifest.xml", "-A", BUILD / "assets", BUILD / "resources.zip",
        "--min-sdk-version", "26", "--target-sdk-version", "35", "--version-code", str(VERSION_CODE), "--version-name", VERSION)
    sources = sorted((ANDROID / "src").rglob("*.java"))
    run("java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-encoding", "UTF-8", "-source", "8", "-target", "8",
        "-Xlint:-options", "-classpath", android_jar, "-d", BUILD / "classes", *sources)
    run("java", "-m", "jdk.jartool/sun.tools.jar.Main", "cf", BUILD / "classes.jar", "-C", BUILD / "classes", ".")
    run(tools / "d8", "--lib", android_jar, "--min-api", "26", "--output", BUILD / "dex", BUILD / "classes.jar")
    with zipfile.ZipFile(BUILD / "unsigned.apk", "a", compression=zipfile.ZIP_DEFLATED) as apk:
        for dex in sorted((BUILD / "dex").glob("*.dex")):
            apk.write(dex, dex.name)
    run(tools / "zipalign", "-p", "-f", "4", BUILD / "unsigned.apk", BUILD / "aligned.apk")
    signing = ANDROID / ".signing"
    signing.mkdir(mode=0o700, exist_ok=True)
    key = Path(os.environ.get("MOON_SIGNING_KEYSTORE", signing / "moon.jks"))
    password = Path(os.environ.get("MOON_SIGNING_PASSWORD_FILE", signing / "password.txt"))
    if not key.exists():
        if os.environ.get("MOON_SIGNING_KEYSTORE"):
            raise RuntimeError("Configured signing keystore does not exist")
        if not password.exists():
            password.write_text(secrets.token_urlsafe(32) + "\n", encoding="utf-8")
            password.chmod(0o600)
        run("keytool", "-genkeypair", "-keystore", key, "-storepass:file", password, "-keypass:file", password,
            "-alias", "moon", "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000", "-dname", "CN=MOON Flight Lab")
        key.chmod(0o600)
    if not password.exists():
        raise RuntimeError("Signing password file is missing")
    output = BUILD / f"MOON-{VERSION}.apk"
    run(tools / "apksigner", "sign", "--ks", key, "--ks-key-alias", "moon", "--ks-pass", "file:" + str(password),
        "--out", output, BUILD / "aligned.apk")
    run(tools / "apksigner", "verify", "--verbose", output)
    run(tools / "zipalign", "-c", "-p", "4", output)
    with zipfile.ZipFile(output) as apk:
        assert "classes.dex" in apk.namelist()
        for file in ["index.html", "style.css", "src/app.js", "src/physics.js", "src/game.js"]:
            assert apk.read("assets/" + file) == (ROOT / "dist" / file).read_bytes(), file
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".apk.sha256").write_text(f"{digest}  {output.name}\n", encoding="utf-8")
    print(f"\nAPK verified: {output}\nSize: {output.stat().st_size:,} bytes\nSHA-256: {digest}")


if __name__ == "__main__":
    main()
