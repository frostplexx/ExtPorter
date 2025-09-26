[private]
default:
  @just --list

[doc('Run extension in clean chromium instance')]
[no-cd]
@run-ext extension_path:
    {{justfile_directory()}}/scripts/chrome-temp-extension.bash "$(realpath {{extension_path}})"

@ls_fs:
    lsof | awk '{print $1}' | sort | uniq -c | sort -rn | head
