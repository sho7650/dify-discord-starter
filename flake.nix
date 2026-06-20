{
  description = "dify-discord-starter — reproducible dev environment (Node.js 22 + npm)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        nodejs = pkgs.nodejs_22;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            nodejs          # Node.js 22 LTS (bundles npm)
            pkgs.nodePackages.prettier
          ];

          shellHook = ''
            echo "dify-discord-starter dev shell"
            echo "  node $(node --version)  |  npm $(npm --version)"
          '';
        };
      });
}
