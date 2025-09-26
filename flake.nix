{
  description = "Minimal development environment with Python, LaTeX, and Node.js";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # Pinned nixpkgs for specific package versions
    nixpkgs-pinned.url = "github:NixOS/nixpkgs/87f3f67a7bf3f84ebe1f6154b50fbb71c4ee8f5c";
  };
  outputs = { self, nixpkgs, flake-utils, nixpkgs-pinned }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
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
            # LaTeX - minimal setup for vimtex
            texlive.combined.scheme-full
            # (texlive.combine {
            #   inherit (texlive) scheme-medium libertine inconsolata;
            # })
            biber
            skim
            # Node.js
            nodejs_24
            yarn
            # Development tools
            just
            fish
            fx
            jq 
            vi-mongo
          ] ++ [
            # Pinned packages from specific commit
            pkgs-pinned.google-chrome # pinned google chrome to 138.0.7204.183
            pkgs-pinned.chromedriver
          ];


          shellHook = ''
            export IN_NIX_SHELL=1
          '';
        };
      });

}
