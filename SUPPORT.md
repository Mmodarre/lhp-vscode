# Support

For questions, reproducible defects and feature requests, use the [Lakehouse Plumber VS Code issue tracker](https://github.com/Mmodarre/lhp-vscode/issues). The [user guide](https://github.com/Mmodarre/lhp-vscode/blob/main/docs/USER_GUIDE.md) covers project setup, native YAML editing, sandbox profiles and generation.

Before reporting a problem, check these common causes:

- **Two Lakehouse Plumber extensions appear:** uninstall the older `Mmodarre.lhp-vscode` VSIX before installing the Marketplace pre-release `MEHDIMODARRESSI.lhp-vscode`. Project files remain in place, but recheck the selected project, interpreter, environment and sandbox mode because extension-local state may reset under the new publisher ID.
- **Project commands stop in Restricted Mode:** use **Manage Workspace Trust**, decide whether to trust the folder, then run the LHP command again. Trust management never resumes the original command automatically.
- **Python or sandbox features are unavailable:** select a Python 3.11+ environment. For Sandbox On, use **LHP: Set Up Python Environment** → **Install or repair LHP in this environment** → **Recommended reviewed LHP integration build**. The reviewed Git build reports package version `0.9.2`; the extension checks its `sandbox_editor` capability.
- **Sandbox scope is missing or invalid:** open **Configuration → Sandbox → Configure profile**, inspect `.lhp/profile.yaml`, save it before generation and review the effective scope. **Show all** changes browsing only.
- **Preview differs from generated output:** preview is source-only and excludes final bundle synchronisation, monitoring finalisation, some managed resources and wheels. Both generation modes replace `generated/<environment>` and update managed `resources/lhp` as applicable. Review the confirmation before generating.

In an issue, include the extension version and ID, VS Code version, operating system, Python version, LHP capability/status shown in Configuration, exact steps, expected and actual behavior, and a **small synthetic** project or redacted YAML if needed. Say whether the workspace is trusted and whether Sandbox is Off or On. Redact credentials, tokens, local usernames, customer names, workspace URLs, table data and private file paths from screenshots and logs before posting. Do not post a real project archive or secrets in a public issue.

The extension does not deploy to or execute in Databricks. For LHP core behavior, use the [LHP core repository](https://github.com/Mmodarre/Lakehouse_Plumber/issues); for YAML language-server behavior, use [Red Hat YAML support](https://github.com/redhat-developer/vscode-yaml/issues).
