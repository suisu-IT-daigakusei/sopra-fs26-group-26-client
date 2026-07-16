{
  description = "Cabo web client development environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachSystem ["aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux"] (
      system: let
        inherit (nixpkgs) lib;

        pkgs = import nixpkgs {
          inherit system;
        };

        nativeBuildInputs = with pkgs;
          [
            nodejs_24
            git
            watchman
          ]
          ++ lib.optionals (system == "aarch64-linux") [
            qemu
          ];
      in {
        devShells.default = pkgs.mkShell {
          inherit nativeBuildInputs;

          shellHook = ''
            export HOST_PROJECT_PATH="$(pwd)"
            export COMPOSE_PROJECT_NAME=cabo-client
            
            export PATH="${pkgs.nodejs_24}/bin:$PATH"
            export PATH="${pkgs.git}/bin:$PATH"
            export PATH="${pkgs.watchman}/bin:$PATH"
            
            if [[ -f package.json && ( ! -d node_modules || -z "$(ls -A node_modules)" ) ]]; then
              echo "Running npm ci to install locked dependencies..."
              npm ci || echo -e "\e[1;31mFailed to run npm ci. Please check package-lock.json.\e[0m"
            fi
          '';
        };
      }
    );
}
