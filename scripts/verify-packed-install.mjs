import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { releasePackages } from "./release-packages.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const rootManifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
const keepTemporary = process.env.VEXA_RELEASE_KEEP_TEMP === "1";

function npmInvocation(args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) return { command: process.execPath, args: [npmCli, ...args] };
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "npm", ...args] };
  }
  return { command: "npm", args };
}

function runNpm(args, { cwd, failureMessage }) {
  return new Promise((resolvePromise, reject) => {
    const invocation = npmInvocation(args);
    const child = spawn(invocation.command, invocation.args, { cwd, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${failureMessage} with code ${code}`));
    });
  });
}

function packageTarballName(name, version) {
  return `${name.replace(/^@/u, "").replaceAll("/", "-")}-${version}.tgz`;
}

function exportEntries(manifest) {
  const value = manifest.exports;
  if (typeof value === "string" || value === null || value === undefined) return [[".", value]];
  const keys = Object.keys(value);
  return keys.some((key) => key.startsWith(".")) ? Object.entries(value) : [[".", value]];
}

function exportTarget(target, condition) {
  if (typeof target === "string") return condition === "import" ? target : undefined;
  if (!target || typeof target !== "object" || Array.isArray(target)) return undefined;
  return typeof target[condition] === "string" ? target[condition] : undefined;
}

function packageSpecifier(name, subpath) {
  return subpath === "." ? name : `${name}/${subpath.replace(/^\.\//u, "")}`;
}

function assertAngularPublishContract(manifest) {
  if (manifest.type !== "module") throw new Error("@vexa-video/angular must publish as an ES module package.");
  if (manifest.sideEffects !== false) throw new Error("@vexa-video/angular must declare sideEffects=false.");
  const rootExport = manifest.exports?.["."];
  if (!rootExport || typeof rootExport !== "object" || Array.isArray(rootExport)) {
    throw new Error("@vexa-video/angular must expose an explicit root export map.");
  }
  if (typeof rootExport.types !== "string" || !rootExport.types.endsWith(".d.ts")) {
    throw new Error("@vexa-video/angular root export must expose declaration types.");
  }
  if (typeof rootExport.import !== "string" || !rootExport.import.endsWith(".js")) {
    throw new Error("@vexa-video/angular root export must expose an ESM JavaScript entry.");
  }
  if (manifest.dependencies?.["@angular/core"]) {
    throw new Error("@vexa-video/angular must keep @angular/core as a peer dependency.");
  }
  if (typeof manifest.peerDependencies?.["@angular/core"] !== "string") {
    throw new Error("@vexa-video/angular must declare @angular/core as a peer dependency.");
  }
  if (typeof manifest.peerDependencies?.rxjs !== "string") {
    throw new Error("@vexa-video/angular must declare rxjs as a peer dependency.");
  }
}

const temporaryRoot = await mkdtemp(resolve(tmpdir(), "vexa-release-install-"));
const tarballDirectory = resolve(temporaryRoot, "tarballs");
const installDirectory = resolve(temporaryRoot, "consumer");

try {
  await mkdir(tarballDirectory, { recursive: true });
  await mkdir(installDirectory, { recursive: true });

  const tarballPaths = [];
  const importSpecifiers = new Set();

  for (const { name, directory } of releasePackages) {
    const manifest = JSON.parse(await readFile(resolve(repositoryRoot, directory, "package.json"), "utf8"));
    const tarballPath = resolve(tarballDirectory, packageTarballName(name, manifest.version));
    console.log(`[release:install] pack ${name}@${manifest.version}`);
    await runNpm(["pack", "--silent", "--workspace", name, "--pack-destination", tarballDirectory], {
      cwd: repositoryRoot,
      failureMessage: `npm pack failed for ${name}`
    });
    await access(tarballPath);
    tarballPaths.push(tarballPath);
  }

  await writeFile(
    resolve(installDirectory, "package.json"),
    `${JSON.stringify({ name: "vexa-release-install-verifier", private: true, type: "module" }, null, 2)}\n`,
    "utf8"
  );

  console.log(`[release:install] install ${tarballPaths.length} packed packages`);
  await runNpm(
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", ...tarballPaths],
    { cwd: installDirectory, failureMessage: "clean packed-package install failed" }
  );

  const installedRoot = await realpath(installDirectory);
  const installedPrefix = installedRoot.endsWith(sep) ? installedRoot : `${installedRoot}${sep}`;

  for (const { name } of releasePackages) {
    const packageDirectory = resolve(installDirectory, "node_modules", ...name.split("/"));
    if ((await lstat(packageDirectory)).isSymbolicLink()) {
      throw new Error(`${name} resolved through a symlink instead of the packed installation.`);
    }
    const packageRealPath = await realpath(packageDirectory);
    if (!packageRealPath.startsWith(installedPrefix)) {
      throw new Error(`${name} resolved outside the clean install workspace: ${packageRealPath}`);
    }

    const manifest = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"));
    if (manifest.version !== rootManifest.version) {
      throw new Error(`${name} installed version ${manifest.version} does not match root ${rootManifest.version}.`);
    }
    if (name === "@vexa-video/angular") assertAngularPublishContract(manifest);

    for (const [subpath, target] of exportEntries(manifest)) {
      const runtimeTarget = exportTarget(target, "import") ?? (typeof target === "string" ? target : undefined);
      const typesTarget = exportTarget(target, "types");
      if (runtimeTarget) await access(resolve(packageDirectory, runtimeTarget));
      if (typesTarget) await access(resolve(packageDirectory, typesTarget));
      if (runtimeTarget && !runtimeTarget.endsWith(".json")) {
        importSpecifiers.add(packageSpecifier(name, subpath));
      }
    }

    const binTargets = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
    for (const binTarget of binTargets) {
      await access(resolve(packageDirectory, String(binTarget)));
    }
  }

  const angularCoreManifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "node_modules", "@angular", "core", "package.json"), "utf8")
  );
  const rxjsManifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "node_modules", "rxjs", "package.json"), "utf8")
  );
  console.log(
    `[release:install] align Angular consumer peers @angular/core@${angularCoreManifest.version} rxjs@${rxjsManifest.version}`
  );
  await runNpm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--no-save",
      `@angular/core@${angularCoreManifest.version}`,
      `rxjs@${rxjsManifest.version}`
    ],
    { cwd: installDirectory, failureMessage: "Angular consumer peer alignment failed" }
  );

  const angularConsumerPath = resolve(installDirectory, "angular-consumer.ts");
  const angularTsconfigPath = resolve(installDirectory, "tsconfig.angular.json");
  await writeFile(
    angularConsumerPath,
    [
      'import type { EnvironmentProviders } from "@angular/core";',
      'import { provideVexaVideo, VexaMediaService, VexaRenderService } from "@vexa-video/angular";',
      "",
      'const providers: EnvironmentProviders = provideVexaVideo({ baseUrl: "https://media.example.test" });',
      "void providers;",
      "void VexaMediaService;",
      "void VexaRenderService;",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    angularTsconfigPath,
    `${JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: false,
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        types: [],
        outDir: "./angular-dist"
      },
      angularCompilerOptions: {
        strictTemplates: true
      },
      files: ["./angular-consumer.ts"]
    }, null, 2)}\n`,
    "utf8"
  );

  const compilerCliDirectory = resolve(repositoryRoot, "node_modules", "@angular", "compiler-cli");
  const compilerCliManifest = JSON.parse(await readFile(resolve(compilerCliDirectory, "package.json"), "utf8"));
  const ngcTarget = typeof compilerCliManifest.bin === "string"
    ? compilerCliManifest.bin
    : compilerCliManifest.bin?.ngc;
  if (typeof ngcTarget !== "string") {
    throw new Error("@angular/compiler-cli does not expose the ngc executable required for release acceptance.");
  }

  console.log("[release:install] compile isolated Angular consumer against packed packages");
  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(compilerCliDirectory, ngcTarget), "-p", angularTsconfigPath],
      { cwd: installDirectory, stdio: "inherit", shell: false }
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`packed Angular consumer compilation failed with code ${code}`));
    });
  });

  const verifierPath = resolve(installDirectory, "verify-imports.mjs");
  const sortedSpecifiers = [...importSpecifiers].sort();
  await writeFile(
    verifierPath,
    [
      `const specifiers = ${JSON.stringify(sortedSpecifiers, null, 2)};`,
      "for (const specifier of specifiers) await import(specifier);",
      'console.log(`[release:install] imported ${specifiers.length} packed export paths`);',
      ""
    ].join("\n"),
    "utf8"
  );

  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [verifierPath], { cwd: installDirectory, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`packed export import verification failed with code ${code}`));
    });
  });

  console.log(`[release:install] ${releasePackages.length} packages passed clean tarball installation.`);
} finally {
  if (keepTemporary) console.log(`[release:install] kept temporary workspace at ${temporaryRoot}`);
  else await rm(temporaryRoot, { recursive: true, force: true });
}
