"""Keep the required SDK CI checks present on every pull request."""

from pathlib import Path
import unittest

WORKFLOWS = Path(__file__).resolve().parents[1] / ".github" / "workflows"
SDK_JOBS = {
    "sdk-typescript.yml": ("TypeScript", "sdks/typescript/", 4),
    "sdk-python.yml": ("Python", "sdks/python/", 5),
    "sdk-go.yml": ("Go", "sdks/go/", 3),
}


class SdkCiGateConfigTests(unittest.TestCase):
    def test_all_sdk_workflows_report_a_unique_gate_on_every_pr(self):
        for filename, (sdk, path, job_count) in SDK_JOBS.items():
            with self.subTest(sdk=sdk):
                content = (WORKFLOWS / filename).read_text()
                pr_trigger = content.split("  pull_request:\n", 1)[1].split("  workflow_dispatch:", 1)[0]
                self.assertNotIn("paths:", pr_trigger, "path-filtered workflow can omit a required check")
                self.assertIn(f"name: SDK {sdk} CI Success", content)
                self.assertIn(f'git diff --quiet "$BASE_SHA" HEAD -- {path}', content)
                if sdk == "TypeScript":
                    shared = ("pnpm-workspace.yaml", "tsconfig.json", "package.json", "pnpm-lock.yaml")
                    self.assertIn(" ".join(shared), content)
                    for filename_on_push in shared:
                        self.assertIn(f'      - "{filename_on_push}"', content.split("  pull_request:", 1)[0])
                self.assertGreaterEqual(
                    content.count("if: needs.changes.outputs.run == 'true'"), job_count
                )
                self.assertIn("if: always()", content)

    def test_oidc_is_not_granted_to_pull_request_validation_jobs(self):
        for filename in ("sdk-typescript.yml", "sdk-python.yml"):
            with self.subTest(workflow=filename):
                content = (WORKFLOWS / filename).read_text()
                header = content.split("\njobs:\n", 1)[0]
                publish = content.split("  publish:\n", 1)[1].split("  sdk-ci-success:\n", 1)[0]
                self.assertNotIn("id-token: write", header)
                self.assertIn("    permissions:\n      contents: read\n      id-token: write", publish)

    def test_gate_definitions_have_a_code_owner(self):
        owners = (WORKFLOWS.parent / "CODEOWNERS").read_text()
        self.assertIn("/.github/ @Divkix", owners.splitlines())
        self.assertIn("/scripts/test_sdk_ci_gate.py @Divkix", owners.splitlines())


if __name__ == "__main__":
    unittest.main()
