#!/usr/bin/env python3
"""Focused regression checks for the repository builder's preflight validation."""

from pathlib import Path
import tempfile
import zipfile

from build import collect_runtime_files, resolve_confined, validate_unique_identifiers, write_runtime_package


def main() -> int:
    validate_unique_identifiers(
        [(Path("first"), "io.github.owner.first"), (Path("second"), "io.github.owner.second")]
    )

    try:
        validate_unique_identifiers(
            [(Path("first"), "io.github.owner.same"), (Path("second"), "io.github.owner.same")]
        )
    except ValueError as error:
        message = str(error)
        assert "Duplicate resolved plugin identifier 'io.github.owner.same'" in message
        assert "first" in message and "second" in message
    else:
        raise AssertionError("duplicate resolved identifiers must fail preflight")

    with tempfile.TemporaryDirectory(prefix="sn-plugins-builder-test-") as temporary:
        root = Path(temporary) / "package"
        outside = Path(temporary) / "outside"
        (root / "dist").mkdir(parents=True)
        outside.mkdir()
        (root / "package.json").write_text("{}\n", encoding="utf-8")
        (root / "dist" / "runtime.js").write_text("runtime", encoding="utf-8")
        (outside / "runtime.js").write_text("outside", encoding="utf-8")
        (root / "escape").symlink_to(outside, target_is_directory=True)

        unsafe_paths = (
            Path("/etc/passwd"),
            root / "dist" / "runtime.js",
            Path("."),
            Path("../outside/runtime.js"),
            Path("dist/../package.json"),
            Path("escape/runtime.js"),
        )
        for unsafe in unsafe_paths:
            try:
                resolve_confined(root, unsafe, "test path")
            except ValueError:
                pass
            else:
                raise AssertionError(f"builder must reject unsafe path {unsafe}")

        package = {"files": ["dist"]}
        runtime_files = collect_runtime_files(root, package)
        assert [path.relative_to(root).as_posix() for path in runtime_files] == [
            "dist/runtime.js",
            "package.json",
        ]
        zip_path = Path(temporary) / "runtime.zip"
        write_runtime_package(root, package, runtime_files, Path(temporary) / "static", zip_path)
        with zipfile.ZipFile(zip_path) as archive:
            names = archive.namelist()
            assert names == ["dist/runtime.js", "package.json"]
            assert all(
                not name.startswith("/") and ".." not in Path(name).parts
                for name in names
            )

    print("build identifier, confinement, and zip-entry validation: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
