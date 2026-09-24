{
  description = "LLM-assisted MV2->MV3 extension migration & verification environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
          };
        };

        python = pkgs.python3.withPackages (ps: [
          ps.pymongo
        ]);
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            tmux
            python
                        claude-code
            nodejs_24
          ];

          shellHook = ''
            export IN_NIX_SHELL=1
            echo "extension migration shell: tmux $(tmux -V | cut -d' ' -f2), $(python3 --version)" >&2
          '';
        };
      }
    );
}
