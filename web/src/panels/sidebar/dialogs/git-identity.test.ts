// The account-level Git identity dialog (comp desktop-r46), and the one
// thing its field recipe must not do to the manager that shares it.
import assert from "node:assert/strict";
import test from "node:test";
import { gitIdentityOnboardingHtml, gitIdentitySettingsHtml } from "./git-identity.ts";

test("the onboarding offers GitHub before the required author fields", () => {
  const html = gitIdentityOnboardingHtml({ busy: false, error: null });
  assert.ok(html.includes(">Git identity</h2>"));
  assert.ok(html.includes('class="dialog-desc">Applies to projects you open next.</span>'), "the description rides in the head with the title");
  assert.ok(html.includes("data-onboarding-git-name required"), "the name is required");
  assert.ok(html.includes('data-onboarding-git-email required type="email"'), "the email is required and typed");
  assert.ok(html.includes("repeat(auto-fit,minmax(184px,1fr))"), "the fields sit side by side and collapse by container width");
  assert.ok(html.includes(">Save identity</button>"));
  assert.ok(html.indexOf("data-github-connect") < html.indexOf("data-onboarding-git-name"));
  assert.ok(html.includes('type="button" data-github-connect'), "connection does not submit the author form");
  assert.ok(!/>Cancel</.test(html), "no Cancel: there is nowhere to cancel to");
  assert.ok(!html.includes("data-git-identities-close"), "no close control on the onboarding path");
  assert.ok(!html.includes("bg-error-tint"), "no error card without an error");
});

test("an error renders once as a card below the fields, and busy holds the primary", () => {
  const html = gitIdentityOnboardingHtml({ busy: true, error: "The write failed." });
  assert.equal(html.split("bg-error-tint").length - 1, 1, "one error card");
  assert.ok(html.includes("The write failed."));
  assert.ok(/data-git-identity-save disabled/.test(html), "Save identity is disabled while busy");
  assert.ok(html.indexOf("data-onboarding-git-email") < html.indexOf("bg-error-tint"), "the error sits below the fields");
});

test("the manager's editor keeps its space above the shared fields", () => {
  const profile = { id: "id-1", name: "Test Author", email: "test@example.invalid", revision: 1, created_at: "t", updated_at: "t" };
  const html = gitIdentitySettingsHtml({
    catalog: { profiles: [profile], default_profile_id: profile.id, revision: 1 },
    defaultProfile: profile, editor: "new", deleteID: null, busy: false, error: null,
  });
  const heading = html.indexOf(">Add email</h3>");
  const fields = html.indexOf("data-editor-git-name");
  assert.ok(heading > 0 && fields > heading, "the editor renders its heading then the fields");
  assert.ok(html.slice(heading, fields).includes('class="mt-4"'), "the editor owns the space between its heading and the fields");
  const onboarding = gitIdentityOnboardingHtml({ busy: false, error: null });
  assert.ok(!onboarding.includes('class="mt-4"'), "the onboarding body sits flush under its head");
});
