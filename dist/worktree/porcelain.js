/** Parse `git worktree list --porcelain` output into structured entries. */
export function parsePorcelainWorktrees(porcelainOutput) {
    const entries = [];
    const blocks = porcelainOutput.split('\n\n').filter(block => block.trim());
    for (const block of blocks) {
        const lines = block.split('\n');
        let worktreePath = '';
        let branch = null;
        let head = '';
        let detached = false;
        let bare = false;
        let prunable = false;
        for (const line of lines) {
            if (line.startsWith('worktree ')) {
                worktreePath = line.slice(9);
            }
            else if (line.startsWith('branch ')) {
                branch = line.slice(7).replace(/^refs\/heads\//, '');
            }
            else if (line.startsWith('HEAD ')) {
                head = line.slice(5);
            }
            else if (line === 'detached') {
                detached = true;
            }
            else if (line === 'bare') {
                bare = true;
            }
            else if (line === 'prunable' || line.startsWith('prunable ')) {
                prunable = true;
            }
        }
        if (worktreePath) {
            entries.push({ worktreePath, branch, head, detached, bare, prunable });
        }
    }
    return entries;
}
//# sourceMappingURL=porcelain.js.map