// Unit tests for src/lib/fields.js
// Tests the --fields response masking logic.
// No network calls, no subprocess — pure in-process assertions.
// Agent rule protected: Rule 2 (always --fields on list calls to reduce token cost).

var applyFields = require("../src/lib/fields").applyFields;

describe("applyFields", function() {

    describe("no fields filter", function() {
        it("returns the object unchanged when fields is null", function() {
            var obj = { name: "report.pdf", path: "/Shared/report.pdf", size: 1024 };
            expect(applyFields(obj, null)).toEqual(obj);
        });

        it("returns the object unchanged when fields is undefined", function() {
            var obj = { name: "report.pdf", size: 1024 };
            expect(applyFields(obj, undefined)).toEqual(obj);
        });
    });

    describe("plain object masking", function() {
        it("returns only the requested field", function() {
            var obj = { name: "file.pdf", path: "/Shared/file.pdf", size: 512 };
            var result = applyFields(obj, "name");
            expect(result).toEqual({ name: "file.pdf" });
        });

        it("returns multiple requested fields", function() {
            var obj = { name: "file.pdf", path: "/Shared/file.pdf", size: 512, entry_id: "abc" };
            var result = applyFields(obj, "name,path");
            expect(result).toEqual({ name: "file.pdf", path: "/Shared/file.pdf" });
        });

        it("ignores fields not present in the object", function() {
            var obj = { name: "file.pdf" };
            var result = applyFields(obj, "name,nonexistent");
            expect(result).toEqual({ name: "file.pdf" });
        });

        it("returns empty object when no requested fields exist", function() {
            var obj = { name: "file.pdf" };
            var result = applyFields(obj, "nonexistent");
            expect(result).toEqual({});
        });

        it("trims whitespace from field names", function() {
            var obj = { name: "file.pdf", size: 100 };
            var result = applyFields(obj, "name, size");
            expect(result).toEqual({ name: "file.pdf", size: 100 });
        });
    });

    describe("array masking", function() {
        it("masks each element of a top-level array", function() {
            var arr = [
                { name: "a.pdf", size: 10, entry_id: "1" },
                { name: "b.pdf", size: 20, entry_id: "2" },
            ];
            var result = applyFields(arr, "name,size");
            expect(result).toEqual([
                { name: "a.pdf", size: 10 },
                { name: "b.pdf", size: 20 },
            ]);
        });
    });

    describe("folder listing response masking", function() {
        it("masks items inside the files array", function() {
            var obj = {
                name:    "Shared",
                path:    "/Shared",
                files:   [{ name: "f.pdf", size: 100, entry_id: "x" }],
                folders: [],
            };
            var result = applyFields(obj, "name,path");
            expect(result.files[0]).toEqual({ name: "f.pdf" });
        });

        it("masks items inside the folders array", function() {
            var obj = {
                name:    "Shared",
                path:    "/Shared",
                files:   [],
                folders: [{ name: "Docs", path: "/Shared/Docs", folder_id: "y" }],
            };
            var result = applyFields(obj, "name");
            expect(result.folders[0]).toEqual({ name: "Docs" });
        });

        it("preserves the files key even when not in --fields (pagination support)", function() {
            var obj = { name: "Shared", path: "/Shared", files: [], folders: [] };
            var result = applyFields(obj, "name");
            expect(result.files).toBeDefined();
            expect(Array.isArray(result.files)).toBe(true);
        });

        it("preserves the folders key even when not in --fields (pagination support)", function() {
            var obj = { name: "Shared", path: "/Shared", files: [], folders: [] };
            var result = applyFields(obj, "name");
            expect(result.folders).toBeDefined();
            expect(Array.isArray(result.folders)).toBe(true);
        });
    });

    describe("content envelope (ai list-kbs)", function() {
        it("--fields content returns full KB objects unfiltered", function() {
            var obj = {
                content: [
                    { id: "kb1", name: "KB One", status: "ACTIVE", type: "KBA", createdBy: "user" },
                ],
            };
            var result = applyFields(obj, "content");
            expect(result.content[0]).toEqual({ id: "kb1", name: "KB One", status: "ACTIVE", type: "KBA", createdBy: "user" });
        });

        it("--fields content,id,name,status masks KB items to requested fields", function() {
            var obj = {
                content: [
                    { id: "kb1", name: "KB One", status: "ACTIVE", type: "KBA", createdBy: "user" },
                    { id: "kb2", name: "KB Two", status: "ACTIVE", type: "KBA", createdBy: "user" },
                ],
            };
            var result = applyFields(obj, "content,id,name,status");
            expect(result.content[0]).toEqual({ id: "kb1", name: "KB One", status: "ACTIVE" });
            expect(result.content[1]).toEqual({ id: "kb2", name: "KB Two", status: "ACTIVE" });
        });

        it("preserves content key even when not in --fields", function() {
            var obj = { content: [{ id: "kb1", name: "KB One" }], total: 1 };
            var result = applyFields(obj, "total");
            expect(result.content).toBeDefined();
            expect(Array.isArray(result.content)).toBe(true);
        });
    });

    describe("results envelope (search / hybrid-search)", function() {
        it("--fields results returns full items unfiltered", function() {
            var obj = { results: [{ name: "f.pdf", path: "/Shared/f.pdf", size: 100 }], count: 1 };
            var result = applyFields(obj, "results");
            expect(result.results[0]).toEqual({ name: "f.pdf", path: "/Shared/f.pdf", size: 100 });
        });

        it("--fields results,name,path masks items", function() {
            var obj = { results: [{ name: "f.pdf", path: "/Shared/f.pdf", size: 100 }], count: 1 };
            var result = applyFields(obj, "results,name,path");
            expect(result.results[0]).toEqual({ name: "f.pdf", path: "/Shared/f.pdf" });
        });

        it("preserves results key even when not in --fields", function() {
            var obj = { results: [{ name: "f.pdf" }], count: 1 };
            var result = applyFields(obj, "count");
            expect(result.results).toBeDefined();
            expect(Array.isArray(result.results)).toBe(true);
        });
    });

    describe("Resources envelope (SCIM users/groups)", function() {
        it("--fields userName,email masks items inside Resources", function() {
            var obj = {
                Resources: [
                    { userName: "jsmith", email: "j@co.com", active: true, userType: "standard" },
                ],
                totalResults: 1,
            };
            var result = applyFields(obj, "userName,email");
            expect(result.Resources[0]).toEqual({ userName: "jsmith", email: "j@co.com" });
        });

        it("preserves Resources key even when not in --fields", function() {
            var obj = { Resources: [{ userName: "jsmith" }], totalResults: 1 };
            var result = applyFields(obj, "totalResults");
            expect(result.Resources).toBeDefined();
            expect(Array.isArray(result.Resources)).toBe(true);
        });
    });

    describe("dotted-path projection (items.name, items.path)", function() {
        it("projects child fields from dotted keys on items array", function() {
            var obj = { items: [{ id: "1", name: "a", path: "/x" }, { id: "2", name: "b", path: "/y" }] };
            var result = applyFields(obj, "items.id,items.name,items.path");
            expect(result.items[0]).toEqual({ id: "1", name: "a", path: "/x" });
            expect(result.items[1]).toEqual({ id: "2", name: "b", path: "/y" });
        });

        it("projects subset of child fields via dotted keys", function() {
            var obj = { items: [{ id: "1", name: "a", path: "/x" }] };
            var result = applyFields(obj, "items.id,items.name");
            expect(result.items[0]).toEqual({ id: "1", name: "a" });
        });

        it("does not leak non-requested child fields", function() {
            var obj = { items: [{ id: "1", name: "a", path: "/x", extra: "z" }] };
            var result = applyFields(obj, "items.name,items.path");
            expect(result.items[0]).toEqual({ name: "a", path: "/x" });
            expect(result.items[0].id).toBeUndefined();
            expect(result.items[0].extra).toBeUndefined();
        });

        it("handles mixed dotted and flat keys", function() {
            var obj = { total: 2, items: [{ id: "1", name: "a" }] };
            var result = applyFields(obj, "total,items.id,items.name");
            expect(result.total).toBe(2);
            expect(result.items[0]).toEqual({ id: "1", name: "a" });
        });

        it("trash list scenario from review comment", function() {
            var obj = { items: [{ id: "1", name: "file.pdf", path: "/Shared/file.pdf" }] };
            var result = applyFields(obj, "items.id,items.name,items.path");
            expect(result.items).toBeDefined();
            expect(result.items.length).toBe(1);
            expect(result.items[0]).toEqual({ id: "1", name: "file.pdf", path: "/Shared/file.pdf" });
        });
    });

    describe("deep dotted-path projection (events.data.target_id)", function() {
        it("projects two levels deep within envelope items", function() {
            var obj = {
                events: [
                    {
                        id: 123,
                        action: "create",
                        data: { target_path: "/x", target_id: "abc", is_folder: false }
                    }
                ]
            };
            var result = applyFields(obj, "events.id,events.data.target_id");
            expect(result.events[0]).toEqual({ id: 123, data: { target_id: "abc" } });
        });

        it("projects multiple deep fields from same parent", function() {
            var obj = {
                events: [
                    { id: 1, data: { target_path: "/x", target_id: "abc", is_folder: false } }
                ]
            };
            var result = applyFields(obj, "events.data.target_path,events.data.target_id");
            expect(result.events[0]).toEqual({ data: { target_path: "/x", target_id: "abc" } });
        });

        it("returns parent intact when parent key selected without children", function() {
            var obj = {
                events: [{ id: 1, data: { target_id: "abc" }, action: "create" }]
            };
            var result = applyFields(obj, "events.id,events.data");
            expect(result.events[0]).toEqual({ id: 1, data: { target_id: "abc" } });
        });
    });

    describe("links envelope (links create/list)", function() {
        it("--fields links,id,url masks link items", function() {
            var obj = { links: [{ id: "abc", url: "https://x.co/abc", type: "file" }] };
            var result = applyFields(obj, "links,id,url");
            expect(result.links[0]).toEqual({ id: "abc", url: "https://x.co/abc" });
        });

        it("--fields links returns full link objects unfiltered", function() {
            var obj = { links: [{ id: "abc", url: "https://x.co/abc", type: "file" }] };
            var result = applyFields(obj, "links");
            expect(result.links[0]).toEqual({ id: "abc", url: "https://x.co/abc", type: "file" });
        });
    });

    // Real Assistant API `ai ask --no-wait` submit response, captured during live QA.
    describe("against a real ai ask --no-wait submit response", function() {
        var fixture = require("./fixtures/ai-ask-submit.json");

        it("filters to executionId,conversationId as ai ask --no-wait --fields would", function() {
            var result = applyFields(fixture, "executionId,conversationId");
            expect(result).toEqual({
                executionId: fixture.executionId,
                conversationId: fixture.conversationId,
            });
        });

        it("passes through unfiltered when --fields is omitted", function() {
            expect(applyFields(fixture)).toEqual(fixture);
        });
    });

});
