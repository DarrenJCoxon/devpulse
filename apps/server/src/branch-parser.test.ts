import { test, expect, describe } from "bun:test";
import { parseBranchToTask, type TaskContext } from "./branch-parser";

describe("parseBranchToTask", () => {
  describe("feature branches with ticket IDs", () => {
    test("parses feature/AUTH-123-login-flow", () => {
      const result = parseBranchToTask("feature/AUTH-123-login-flow");
      expect(result).toEqual({
        prefix: "feature",
        ticket_id: "AUTH-123",
        description: "Login Flow",
        display: "AUTH-123: Login Flow"
      });
    });

    test("parses feature/PROJ-42-new-feature", () => {
      const result = parseBranchToTask("feature/PROJ-42-new-feature");
      expect(result).toEqual({
        prefix: "feature",
        ticket_id: "PROJ-42",
        description: "New Feature",
        display: "PROJ-42: New Feature"
      });
    });

    test("parses feature/ABC-999-multiple-word-description", () => {
      const result = parseBranchToTask("feature/ABC-999-multiple-word-description");
      expect(result).toEqual({
        prefix: "feature",
        ticket_id: "ABC-999",
        description: "Multiple Word Description",
        display: "ABC-999: Multiple Word Description"
      });
    });
  });

  describe("fix branches", () => {
    test("parses fix/broken-navbar without ticket ID", () => {
      const result = parseBranchToTask("fix/broken-navbar");
      expect(result).toEqual({
        prefix: "fix",
        ticket_id: "",
        description: "Broken Navbar",
        display: "Fix: Broken Navbar"
      });
    });

    test("parses fix/BUG-456-critical-error with ticket ID", () => {
      const result = parseBranchToTask("fix/BUG-456-critical-error");
      expect(result).toEqual({
        prefix: "fix",
        ticket_id: "BUG-456",
        description: "Critical Error",
        display: "BUG-456: Critical Error"
      });
    });
  });

  describe("chore branches", () => {
    test("parses chore/update-deps", () => {
      const result = parseBranchToTask("chore/update-deps");
      expect(result).toEqual({
        prefix: "chore",
        ticket_id: "",
        description: "Update Deps",
        display: "Chore: Update Deps"
      });
    });

    test("parses chore/MAINT-100-dependency-updates", () => {
      const result = parseBranchToTask("chore/MAINT-100-dependency-updates");
      expect(result).toEqual({
        prefix: "chore",
        ticket_id: "MAINT-100",
        description: "Dependency Updates",
        display: "MAINT-100: Dependency Updates"
      });
    });
  });

  describe("hotfix branches", () => {
    test("parses hotfix/critical-bug", () => {
      const result = parseBranchToTask("hotfix/critical-bug");
      expect(result).toEqual({
        prefix: "hotfix",
        ticket_id: "",
        description: "Critical Bug",
        display: "Hotfix: Critical Bug"
      });
    });

    test("parses hotfix/URGENT-789-production-crash", () => {
      const result = parseBranchToTask("hotfix/URGENT-789-production-crash");
      expect(result).toEqual({
        prefix: "hotfix",
        ticket_id: "URGENT-789",
        description: "Production Crash",
        display: "URGENT-789: Production Crash"
      });
    });
  });

  describe("release branches", () => {
    test("parses release/v2.1.0", () => {
      const result = parseBranchToTask("release/v2.1.0");
      expect(result).toEqual({
        prefix: "release",
        ticket_id: "",
        description: "V2.1.0",
        display: "Release: V2.1.0"
      });
    });

    test("parses release/1.0.0-beta", () => {
      const result = parseBranchToTask("release/1.0.0-beta");
      expect(result).toEqual({
        prefix: "release",
        ticket_id: "",
        description: "1.0.0 Beta",
        display: "Release: 1.0.0 Beta"
      });
    });
  });

  describe("other supported prefixes", () => {
    test("parses bugfix/spelling-error", () => {
      const result = parseBranchToTask("bugfix/spelling-error");
      expect(result).toEqual({
        prefix: "bugfix",
        ticket_id: "",
        description: "Spelling Error",
        display: "Bugfix: Spelling Error"
      });
    });

    test("parses refactor/API-234-clean-controllers", () => {
      const result = parseBranchToTask("refactor/API-234-clean-controllers");
      expect(result).toEqual({
        prefix: "refactor",
        ticket_id: "API-234",
        description: "Clean Controllers",
        display: "API-234: Clean Controllers"
      });
    });

    test("parses docs/update-readme", () => {
      const result = parseBranchToTask("docs/update-readme");
      expect(result).toEqual({
        prefix: "docs",
        ticket_id: "",
        description: "Update Readme",
        display: "Docs: Update Readme"
      });
    });

    test("parses test/add-unit-tests", () => {
      const result = parseBranchToTask("test/add-unit-tests");
      expect(result).toEqual({
        prefix: "test",
        ticket_id: "",
        description: "Add Unit Tests",
        display: "Test: Add Unit Tests"
      });
    });
  });

  describe("nested slashes (multi-level branches)", () => {
    test("parses feature/team/AUTH-456-multi-level", () => {
      const result = parseBranchToTask("feature/team/AUTH-456-multi-level");
      expect(result).toEqual({
        prefix: "feature",
        ticket_id: "AUTH-456",
        description: "Multi Level",
        display: "AUTH-456: Multi Level"
      });
    });

    test("parses fix/backend/database/DB-999-connection-pool", () => {
      const result = parseBranchToTask("fix/backend/database/DB-999-connection-pool");
      expect(result).toEqual({
        prefix: "fix",
        ticket_id: "DB-999",
        description: "Connection Pool",
        display: "DB-999: Connection Pool"
      });
    });
  });

  describe("branches without recognized prefix (passthrough)", () => {
    test("parses main", () => {
      const result = parseBranchToTask("main");
      expect(result).toEqual({
        prefix: "",
        ticket_id: "",
        description: "main",
        display: "main"
      });
    });

    test("parses develop", () => {
      const result = parseBranchToTask("develop");
      expect(result).toEqual({
        prefix: "",
        ticket_id: "",
        description: "develop",
        display: "develop"
      });
    });

    test("parses staging", () => {
      const result = parseBranchToTask("staging");
      expect(result).toEqual({
        prefix: "",
        ticket_id: "",
        description: "staging",
        display: "staging"
      });
    });

    test("parses unknown-prefix/some-branch", () => {
      const result = parseBranchToTask("unknown-prefix/some-branch");
      expect(result).toEqual({
        prefix: "",
        ticket_id: "",
        description: "unknown-prefix/some-branch",
        display: "unknown-prefix/some-branch"
      });
    });
  });

  describe("edge cases", () => {
    test("handles empty string", () => {
      const result = parseBranchToTask("");
      expect(result).toEqual({
        prefix: "",
        ticket_id: "",
        description: "",
        display: ""
      });
    });

    test("handles whitespace-only string", () => {
      const result = parseBranchToTask("   ");
      expect(result).toEqual({
        prefix: "",
        ticket_id: "",
        description: "",
        display: ""
      });
    });

    test("handles branch with only prefix (no description)", () => {
      const result = parseBranchToTask("feature/");
      expect(result).toEqual({
        prefix: "feature",
        ticket_id: "",
        description: "",
        display: "Feature"
      });
    });

    test("handles branch with ticket ID but no description", () => {
      const result = parseBranchToTask("feature/AUTH-123");
      expect(result).toEqual({
        prefix: "feature",
        ticket_id: "AUTH-123",
        description: "",
        display: "AUTH-123"
      });
    });

    test("handles multiple hyphens in description", () => {
      const result = parseBranchToTask("fix/this-is-a-very-long-branch-name");
      expect(result).toEqual({
        prefix: "fix",
        ticket_id: "",
        description: "This Is A Very Long Branch Name",
        display: "Fix: This Is A Very Long Branch Name"
      });
    });

    test("handles ticket IDs with multiple letter sections", () => {
      const result = parseBranchToTask("feature/PROJECT-TEAM-123-description");
      expect(result).toEqual({
        prefix: "feature",
        ticket_id: "PROJECT-TEAM-123",
        description: "Description",
        display: "PROJECT-TEAM-123: Description"
      });
    });

    test("handles case insensitivity for prefix", () => {
      const result = parseBranchToTask("FEATURE/AUTH-123-login");
      expect(result).toEqual({
        prefix: "feature",
        ticket_id: "AUTH-123",
        description: "Login",
        display: "AUTH-123: Login"
      });
    });

    test("handles underscores in description", () => {
      const result = parseBranchToTask("fix/broken_nav_bar");
      expect(result).toEqual({
        prefix: "fix",
        ticket_id: "",
        description: "Broken Nav Bar",
        display: "Fix: Broken Nav Bar"
      });
    });

    test("handles mixed separators (hyphens and underscores)", () => {
      const result = parseBranchToTask("chore/update-deps_and_fix-issues");
      expect(result).toEqual({
        prefix: "chore",
        ticket_id: "",
        description: "Update Deps And Fix Issues",
        display: "Chore: Update Deps And Fix Issues"
      });
    });
  });

  describe("real-world examples", () => {
    test("parses typical Jira ticket branch", () => {
      const result = parseBranchToTask("feature/JIRA-1234-implement-user-authentication");
      expect(result).toEqual({
        prefix: "feature",
        ticket_id: "JIRA-1234",
        description: "Implement User Authentication",
        display: "JIRA-1234: Implement User Authentication"
      });
    });

    test("parses typical GitHub issue branch", () => {
      const result = parseBranchToTask("fix/GH-567-fix-memory-leak-in-cache");
      expect(result).toEqual({
        prefix: "fix",
        ticket_id: "GH-567",
        description: "Fix Memory Leak In Cache",
        display: "GH-567: Fix Memory Leak In Cache"
      });
    });

    test("parses Linear ticket branch", () => {
      const result = parseBranchToTask("feature/LIN-89-add-dark-mode");
      expect(result).toEqual({
        prefix: "feature",
        ticket_id: "LIN-89",
        description: "Add Dark Mode",
        display: "LIN-89: Add Dark Mode"
      });
    });
  });
});
