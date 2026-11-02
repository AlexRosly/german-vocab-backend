import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "node:net";
import { PrismaService } from "../src/prisma.service";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { WordAccessService } from "../src/words/word-access.service";
import { WordRelationsService } from "../src/words/word-relations.service";
import { WordRelationsController } from "../src/words/word-relations.controller";
import { admin, makeWordsDatabase, userA, userB } from "./support/words-database";

describe("Related words: real access rules and HTTP, in-memory persistence", () => {
  let app: INestApplication, base: string;
  let fixture: ReturnType<typeof makeWordsDatabase>;
  let service: WordRelationsService;
  let edges: Map<string, { leftWordId: string; rightWordId: string }>;
  beforeEach(async () => {
    fixture = makeWordsDatabase(); edges = new Map();
    const pairKey = (pair: { leftWordId: string; rightWordId: string }) => pair.leftWordId + ":" + pair.rightWordId;
    const db = Object.assign(fixture.db, { wordRelation: {
      findMany: jest.fn(async ({ where }: any) => [...edges.values()].filter(edge => where.OR.some((clause: any) => Object.entries(clause).every(([key, value]) => edge[key as keyof typeof edge] === value)))),
      upsert: jest.fn(async ({ create }: any) => { edges.set(pairKey(create), create); return create; }),
      deleteMany: jest.fn(async ({ where }: any) => ({ count: edges.delete(pairKey(where)) ? 1 : 0 })),
    } });
    fixture.seedWord("source", { createdByUserId: userA.id });
    fixture.seedWord("public", { german: "erwarten" });
    fixture.seedWord("own", { german: "sicher sein", publicationStatus: "PENDING_REVIEW", createdByUserId: userA.id });
    fixture.seedWord("foreign", { publicationStatus: "REJECTED", createdByUserId: userB.id });
    const module = await Test.createTestingModule({ imports: [AuthModule], controllers: [WordRelationsController], providers: [PrismaService, WordAccessService, WordRelationsService] })
      .overrideProvider(PrismaService).useValue(db)
      .overrideProvider(AuthService).useValue({ authenticate: async (token: string) => {
        const user = token === "a".repeat(43) ? userA : token === "b".repeat(43) ? userB : token === "c".repeat(43) ? admin : null;
        if (!user) throw new UnauthorizedException(); return { user, sessionId: "session" };
      } }).compile();
    service = module.get(WordRelationsService);
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1"); base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/words`;
  });
  afterEach(async () => app?.close());
  const request = (path: string, method = "GET", actor = "a") => fetch(base + path, { method, headers: actor ? { Authorization: `Bearer ${actor.repeat(43)}` } : {} });

  it("requires auth for reads, adds, and removals", async () => {
    for (const [path, method] of [["/source/relations", "GET"], ["/source/relations/public", "PUT"], ["/source/relations/public", "DELETE"]]) expect((await request(path, method, "")).status).toBe(401);
    expect(edges.size).toBe(0);
  });
  it("only ADMIN can add or remove and the ID direction is idempotent", async () => {
    expect((await request("/source/relations/public", "PUT")).status).toBe(403);
    expect((await request("/source/relations/public", "PUT", "c")).status).toBe(200);
    expect((await request("/public/relations/source", "PUT", "c")).status).toBe(200);
    expect(edges.size).toBe(1);
    expect((await (await request("/source/relations")).json()).map((row: any) => row.id)).toEqual(["public"]);
    expect((await (await request("/public/relations")).json()).map((row: any) => row.id)).toEqual(["source"]);
    expect((await request("/public/relations/source", "DELETE", "b")).status).toBe(403);
    expect((await request("/public/relations/source", "DELETE", "c")).status).toBe(200);
    expect((await request("/source/relations/public", "DELETE", "c")).status).toBe(200);
    expect(edges.size).toBe(0);
  });
  it("filters unpublished targets without leaking counts or foreign IDs", async () => {
    for (const id of ["public", "own", "foreign"]) await service.save(admin, "source", id);
    expect((await service.list(userA, "source")).map(row => row.id).sort()).toEqual(["own", "public"]);
    expect((await service.list(userB, "source")).map(row => row.id).sort()).toEqual(["foreign", "public"]);
    expect((await service.list(admin, "source")).length).toBe(3);
  });
  it("hides a private source and a public target after unpublication", async () => {
    await service.save(admin, "own", "public");
    expect((await request("/own/relations", "GET", "b")).status).toBe(404);
    await service.save(admin, "source", "public");
    fixture.words.get("public")!.publicationStatus = "REJECTED";
    expect(await service.list(userA, "source")).toEqual([]);
  });
  it("rejects self links, missing cards, and malformed identifiers before writing", async () => {
    expect((await request("/source/relations/source", "PUT", "c")).status).toBe(400);
    expect((await request("/source/relations/missing", "PUT", "c")).status).toBe(404);
    expect((await request("/bad%20id/relations", "GET", "c")).status).toBe(400);
    expect(edges.size).toBe(0);
  });
  it("returns selected translation without substituting Russian and disables caches", async () => {
    await service.save(admin, "source", "public");
    const res = await request("/source/relations");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json())[0].selectedTranslation).toEqual({ language: "ru", text: null });
    expect(fixture.links.size).toBe(0);
    expect(fixture.words.get("source")!.publicationStatus).toBe("PUBLISHED");
    expect(fixture.db.word.update).not.toHaveBeenCalled();
  });
});
