# TOOLS

You have access to a variety of custom skills mapped to Gemini function calls.
These tools are defined in the `skills/` directory.

### Core Skills
- `sandbox_execute`: Run code (Python, Bash, Node) safely inside an isolated Docker container and return the output.
- `read_memory`: Read conversation history from the `memory/` directory.
- `write_memory`: Save important facts or session summaries to the `memory/` directory.

### File System Access (Within Container)
gemiclaw runs in a container but has access to mapped volumes from the host:
- `/app/workspace/`: Use this path to create, read, or manage project files you are working on for the user.
- `/app/knowledge/`: Use this path to read external knowledge, documentation, or reference files provided by the user.
