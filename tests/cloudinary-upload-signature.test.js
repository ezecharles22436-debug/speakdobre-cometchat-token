const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/cloudinary-upload-signature");

test.beforeEach(() => {
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  process.env.CLOUDINARY_SIGNED_UPLOAD_PRESET = "signed-profile-photo";
});

test("signed parameters use a stable opaque per-member asset id", () => {
  const first = handler._test.buildSignedParams("member-123", 1700000000);
  const second = handler._test.buildSignedParams("member-123", 1700000001);
  const other = handler._test.buildSignedParams("member-456", 1700000000);

  assert.equal(first.public_id, second.public_id);
  assert.notEqual(first.public_id, other.public_id);
  assert.equal(first.public_id.includes("member-123"), false);
  assert.equal(first.asset_folder, "speakdobre/profile-photos");
  assert.equal(first.allowed_formats, "jpg,png,webp");
  assert.equal(first.transformation, "c_limit,h_1200,w_1200");
  assert.equal(first.overwrite, "true");
});

test("Cloudinary signature is deterministic and covers every parameter", () => {
  const params = handler._test.buildSignedParams("member-123", 1700000000);
  const signature = handler._test.signUploadParams(params, "test-secret");
  assert.match(signature, /^[a-f0-9]{40}$/);
  assert.equal(signature, handler._test.signUploadParams(params, "test-secret"));
  assert.notEqual(signature, handler._test.signUploadParams({ ...params, overwrite: "false" }, "test-secret"));
});

test("bearer token parser rejects malformed authorization", () => {
  assert.equal(handler._test.readBearerToken("Bearer valid-token"), "valid-token");
  assert.equal(handler._test.readBearerToken("Basic value"), null);
  assert.equal(handler._test.readBearerToken("Bearer   "), null);
});

test("endpoint rejects unsupported methods before external calls", async () => {
  const headers = {};
  const response = {
    setHeader(name, value) { headers[name] = value; },
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  await handler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(headers.Allow, "POST, OPTIONS");
});
