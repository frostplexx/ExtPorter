{
  description = "Minimal development environment with Python, LaTeX, and Node.js";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # Pinned nixpkgs for specific package versions
    nixpkgs-pinned.url = "github:NixOS/nixpkgs/87f3f67a7bf3f84ebe1f6154b50fbb71c4ee8f5c";
  };
  outputs = { nixpkgs, flake-utils, nixpkgs-pinned, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
          };
        };
        pkgs-pinned = import nixpkgs-pinned {
          inherit system;
          config = {
            allowUnfree = true;
          };
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Python
            python312
            uv
            # Node.js
            nodejs_24
            yarn
            # Development tools
            fish
            fx
            jq 
            vi-mongo
            google-chrome
            ollama
            bat
            sshpass
          ] ++ [
            # Pinned packages from specific commit
            pkgs-pinned.google-chrome # pinned google chrome to 138.0.7204.183
            pkgs-pinned.chromedriver
          ];


          shellHook = ''
            export IN_NIX_SHELL=1
            export NODE_OPTIONS="--max-old-space-size=8192 --max-semi-space-size=512 --expose-gc"
            # Alternative heap size options (comment out above and uncomment one below to use):
            # NODE_OPTIONS=--max-old-space-size=4096 --expose-gc     # 4GB heap
            # NODE_OPTIONS=--max-old-space-size=16384 --expose-gc    # 16GB heap
            export CHROME_138="${pkgs-pinned.google-chrome}"
            export CHROME_LATESTS="${pkgs.google-chrome}"
          '';
        };
      });

}
