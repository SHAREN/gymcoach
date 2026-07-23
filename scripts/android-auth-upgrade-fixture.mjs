import http from "node:http";

const port = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("A valid unprivileged fixture port is required.");
}

const expectedAuthorization = "Bearer upgrade-regression-sentinel";

const server = http.createServer((request, response) => {
  if (request.headers.authorization !== expectedAuthorization) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Unauthorized", code: "mobile_auth_not_found" }));
    return;
  }

  if (request.method === "GET" && request.url === "/api/mobile/bootstrap") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        schemaVersion: 9,
        calculationVersion: "upgrade-regression",
        serverTime: "2026-07-23T00:00:00.000Z",
        profile: {
          id: "upgrade-regression-user",
          email: "upgrade-regression@example.invalid",
          displayName: "Upgrade Regression",
        },
      }),
    );
    return;
  }

  if (request.method === "GET" && request.url === "/api/profile") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        email: "upgrade-regression@example.invalid",
        displayName: "Upgrade Regression",
      }),
    );
    return;
  }

  if (request.method === "POST" && request.url === "/api/mobile/auth/logout") {
    response.writeHead(204);
    response.end();
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found", code: "not_found" }));
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`READY ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
