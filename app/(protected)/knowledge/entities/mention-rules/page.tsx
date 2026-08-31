import Link from "next/link";

import { CONTACT_MENTION_PROVISIONAL_MIN_SOURCE_EMAILS } from "@/lib/contacts/mention-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WELL_KNOWN = CONTACT_MENTION_PROVISIONAL_MIN_SOURCE_EMAILS;

export default function MentionRulesPage() {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 pb-12">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Contacts
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            How mentions become people
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Use this page when a name in Mentions looks wrong. It is the
            matching rulebook — not a list of bugs.
          </p>
          <p className="mt-2 text-sm">
            <Link
              href="/knowledge/entities?tab=contacts"
              className="font-medium text-teal-800 hover:underline"
            >
              Back to Contacts
            </Link>
            {" · "}
            <Link
              href="/knowledge/entities?tab=organizations"
              className="font-medium text-teal-800 hover:underline"
            >
              Back to Organizations
            </Link>
            {" · "}
            <Link
              href="/knowledge/entities?tab=projects"
              className="font-medium text-teal-800 hover:underline"
            >
              Back to Projects
            </Link>
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Two different things
          </h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>
              A <strong>mention</strong> is “we saw this name in an email.”
              Example: the body says “Haider,” or “Dan from XYZ.” It belongs
              to that one message — not every other email in the thread.
            </li>
            <li>
              A <strong>person</strong> is a People card with a real identity.
              Example: Haider Mukadam.
            </li>
          </ul>
          <p className="text-sm text-slate-700">
            Mentions do not create new people. They sit in the Mentions tab
            until the matcher can attach them to someone who already exists —
            or until you attach them by hand.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            The four Mentions lists
          </h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>
              <strong>Unresolved</strong> — not attached yet, and the harvest
              did not store a last name. The matcher did not have a unique
              answer, or you have not attached it yet.
            </li>
            <li>
              <strong>Full names</strong> — unresolved mentions that already
              have a first and last name. Ingest is supposed to mint a People
              card from that, so these are leftovers / leaks. Create a person
              from the group, or attach to someone who already exists if the
              spelling is close.
            </li>
            <li>
              <strong>Provisional</strong> — attached as a best guess. If a
              second person later collides with that guess, the link is taken
              back.
            </li>
            <li>
              <strong>Thread participant</strong> — attached because that first
              name was also on the email’s To/From line, and only one matching
              person was there.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            What Convert stubs does{" "}
            <span className="font-normal text-slate-600">
              (stub = first-name-only People card with no last name, email, or
              phone)
            </span>
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Copies harvested names from emails into the mentions table.</li>
            <li>Removes first-name-only stub people (so “Haider” is not a People card).</li>
            <li>
              Drops mentions whose name, email, or phone does not appear on
              that source email (headers or <em>this message’s unique
              content</em>). Quoted reply history does not count — a Judy
              sighting in an earlier email is not copied onto later replies
              that only repeat that paragraph.
            </li>
            <li>
              Runs the matcher on unresolved mentions. A dialog stays open
              until that finishes, then shows how many were confirmed,
              provisional, or still unresolved.
            </li>
          </ol>
          <p className="text-sm text-slate-700">
            If harvest and stubs are already done, Convert stubs still drops
            misplaced mentions (step 3) and re-runs the matcher (step 4). That
            is how new matching rules get applied to names that are already
            sitting in Unresolved.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Matching rules (first match wins)
          </h2>
          <p className="text-sm text-slate-700">
            The matcher walks this list from the top. It stops at the first
            rule that applies.
          </p>

          <Rule
            n={1}
            title="Email address or phone number"
            result="Confirmed"
            example="The mention includes haider@icc… and that mailbox already belongs to Haider Mukadam."
          />
          <Rule
            n={2}
            title="That first name is on the To/From line"
            result="Confirmed if exactly one matching person is on the thread. Unresolved if two people with that first name are on the thread."
            example="Body says “Haider.” The To line has Haider Mukadam and nobody else named Haider → confirmed. Two Haiders on To → left unresolved."
          />
          <Rule
            n={3}
            title="First and last name on the mention"
            result="Confirmed if exactly one person has that name. Unresolved if two people share it."
            example="The harvest stored “Haider Mukadam.” There is one person named Haider Mukadam → confirmed, even if that person only appears in a couple of emails. A middle initial on the People card (John P.) still matches a body that only says John."
          />
          <Rule
            n={4}
            title="Full name already in the email subject"
            result="Confirmed if exactly one known person’s full name appears in the subject."
            example={`Body only says “Haider.” Subject is “Re: Haider Mukadam - Condominium Manager.” One person named Haider Mukadam → confirmed. A different person named Haider Khan is not chosen just because the first name matches.`}
          />
          <Rule
            n={5}
            title="First name plus company"
            result={`Provisional if there is exactly one well-known person with that first name at that company (seen in ${WELL_KNOWN}+ emails). Unresolved if they are barely mentioned, or if two Dans work at the same company.`}
            example="“Dan from XYZ Consulting,” and Dan Miller is the only Dan at XYZ with many emails → provisional. A brand-new Dan at XYZ stays unresolved."
          />
          <Rule
            n={6}
            title="First name only"
            result={`Provisional if there is exactly one well-known person with that first name (${WELL_KNOWN}+ emails). Unresolved if several people share the name, or the only match is thinly mentioned.`}
            example="Only one Margot in the registry, and she is in many emails → provisional. “Dan” with several Dans, or a barely-seen Dan → unresolved. This is why a bare “Haider” used to wait even when the subject already had Mukadam — rules 3 and 4 did not exist yet."
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            What “well-known” means
          </h2>
          <p className="text-sm text-slate-700">
            At least {WELL_KNOWN} emails (or mention weight) already on that
            person. First-name-only guesses are not allowed for thin records.
            First+last and subject matches do not wait for this bar — a last
            name is already enough context.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Provisional can be taken back
          </h2>
          <p className="text-sm text-slate-700">
            If “Dan at XYZ” was attached because he was the only Dan there, and
            a second Dan at XYZ appears later, those provisional links return
            to Unresolved. Confirmed links (email, phone, first+last, subject,
            unique person on the thread) stay attached.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            What the system will not do
          </h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>
              Mint a new People card from a first-name-only mention. Full-name
              leftovers (first + last, no matching person) sit in Mentions →
              Full names so you can create a card by hand.
            </li>
            <li>
              Attach “Haider” to Haider Mukadam only because they share a first
              name, if another Haider exists, unless last name, subject,
              thread, or company settles it.
            </li>
            <li>
              Guess among several companies on the same email. Company is
              copied onto a mention only when the email has exactly one
              company name.
            </li>
          </ul>
        </section>

        <section id="projects" className="space-y-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Projects
          </p>
          <h2 className="text-lg font-semibold text-slate-900">
            How project mentions attach
          </h2>
          <p className="text-sm text-slate-700">
            A project mention is “we saw this work name in an email.” It sits
            in Mentions until the matcher attaches it to a Projects card.
            Process pending project merges re-syncs the registry (including
            aliases) and re-runs the matcher. Re-harvest thread runs contact
            and project passes 1–4 on that mail so you can test historical
            emails in the browser.
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>
              <strong>Unresolved</strong> — not attached. Ambiguous names,
              year mismatches, or cards that failed the minting gate stay here.
            </li>
            <li>
              <strong>Provisional</strong> — unique work-name match
              (<code>unique_work_name_provisional</code>). Taken back if a
              second project later collides.
            </li>
            <li>
              <strong>Confirmed</strong> — unique identity key or unique exact
              name/alias with overlapping years (
              <code>unique_identity_key</code>,{" "}
              <code>unique_name_or_alias</code>).
            </li>
          </ul>
        </section>

        <section id="organizations" className="space-y-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Organizations
          </p>
          <h2 className="text-lg font-semibold text-slate-900">
            How organization mentions attach
          </h2>
          <p className="text-sm text-slate-700">
            An organization mention is “this email used this name.” Confirmed
            and provisional rows are the source of truth for Wikipedia emails,
            harvest marks, registry totals, and Also-known-as counts.
            Fingerprint harvest-name bucketing is only a fallback when a card
            has no mention overlay yet.
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>
              Auto-confirm uses this email only: unique mailbox, website,
              distinctive legal name, unique header domain, or unique alias
              that is not a prefix of another org (TCG can confirm; Trace
              cannot while Trace Fire / Maintenance exist).
            </li>
            <li>
              Prefix collisions stay unresolved with those orgs as candidates.
              That is why an alias row can show a dash even when the org
              total is large — it is not a character-length gate.
            </li>
            <li>
              Profile snippets paint the canonical name, every registry
              alias, and stored mention spans. They do not Command-F the
              mailbox with distinctive-alias LIKE.
            </li>
          </ul>
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Checking a problem
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Open the mention group and read the sample: first name, last name, company, subject.</li>
            <li>
              Open the email. If the name is not on that message (headers or
              body), Convert stubs should drop it — it is not a matching-rule
              miss.
            </li>
            <li>Walk the six rules above. If a higher rule applies, a lower one is ignored.</li>
            <li>
              If the subject already has the full name and there is one matching
              person, it should confirm after Convert stubs finishes (not after
              a quick “OK”).
            </li>
            <li>
              If several people share that first name and there is no last
              name, subject match, thread match, or unique company, Unresolved
              is correct — attach by hand.
            </li>
          </ol>
        </section>
      </div>
    </section>
  );
}

function Rule({
  n,
  title,
  result,
  example,
}: {
  n: number;
  title: string;
  result: string;
  example: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">
        {n}. {title}
      </p>
      <p className="mt-1 text-sm text-slate-700">{result}</p>
      <p className="mt-2 text-sm text-slate-600">
        <span className="font-medium text-slate-700">Example: </span>
        {example}
      </p>
    </div>
  );
}
