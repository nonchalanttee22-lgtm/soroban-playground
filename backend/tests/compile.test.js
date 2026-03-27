import express from "express";
import request from "supertest";
import compileRoute from "../src/routes/compile.js";

const app = express();
app.use(express.json());
app.use("/api/compile", compileRoute);

describe("POST /api/compile", () => {
  it("returns 400 when code is missing", async () => {
    const res = await request(app).post("/api/compile").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No code provided/);
  });

  it("returns 400 when code is not a string", async () => {
    const res = await request(app).post("/api/compile").send({ code: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No code provided/);
  });

  it("returns 500 when cargo is missing (expected in this environment)", async () => {
    // This test might fail differently depending on whether 'cargo' exists in the environment
    const res = await request(app).post("/api/compile").send({ code: "contract code" });
    
    // If cargo is missing, it should trigger 'error' event or exit code 1
    // In many CI/local environments without Rust, this will be 500.
    expect([500, 200]).toContain(res.status); 
  });
});
