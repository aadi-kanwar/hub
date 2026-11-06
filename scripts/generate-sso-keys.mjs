// Makes the single sign-on key pair (Ed25519 / EdDSA) that the hub signs tool
// tickets with. Run it ONCE; running it again makes a new pair, and then every
// app must get the new public key too.
//
//   npm run sso:keys                 prints the `npx convex env set` commands
//   npm run sso:keys -- --out <dir>  writes the keys to files in <dir> instead
//                                    (nothing secret is printed)
//
// Where each value goes:
//   hub's Convex deployment:            SSO_PRIVATE_KEY   (secret, hub only)
//   MealSync's and Staff's deployments: HUB_SSO_PUBLIC_KEY (safe to share)
//
// The keys are never written into this repository. Line breaks in the PEM text
// are written as "\n" so each value fits on one line; the hub and the apps turn
// them back into real line breaks when reading the key.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";

const oneLine = (pem) => pem.trim().replace(/\r?\n/g, "\\n");

const { privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
const privatePem = oneLine(await exportPKCS8(privateKey));
const publicPem = oneLine(await exportSPKI(publicKey));

const outIndex = process.argv.indexOf("--out");
if (outIndex !== -1) {
  const dir = process.argv[outIndex + 1];
  if (!dir) {
    console.error("Give a folder after --out, outside this repository.");
    process.exit(1);
  }
  const target = resolve(dir);
  if (target.startsWith(resolve(import.meta.dirname, ".."))) {
    console.error("Choose a folder outside this repository, so the keys can't be committed.");
    process.exit(1);
  }
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const privatePath = join(target, "SSO_PRIVATE_KEY");
  const publicPath = join(target, "HUB_SSO_PUBLIC_KEY");
  writeFileSync(privatePath, privatePem, { mode: 0o600 });
  chmodSync(privatePath, 0o600);
  writeFileSync(publicPath, publicPem, { mode: 0o644 });
  console.log(`Wrote ${privatePath} (secret) and ${publicPath}.`);
  process.exit(0);
}

const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
console.log(`# Run each command in the folder of the app named, with THAT app's deploy key.
# Keep the private key secret: it goes on the hub only, never in git or chat.

# 1. Hub (this folder):
npx convex env set SSO_PRIVATE_KEY -- ${quote(privatePem)}

# 2. MealSync (Dine) folder, and 3. Staff folder:
npx convex env set HUB_SSO_PUBLIC_KEY -- ${quote(publicPem)}
`);
