import { describe, expect, it } from 'vitest';
import {
  shadcnNotMuiPolicy,
  findMuiImports
} from '../../src/policies/shadcn-not-mui.js';
import { makeCtx } from '../fixtures.js';

describe('shadcn-not-mui policy', () => {
  describe('pass cases', () => {
    it('passes a brief that mentions shadcn primitives only', async () => {
      const v = await shadcnNotMuiPolicy.check(
        makeCtx({ briefMd: 'Use Button from @/components/ui/button.' })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when brief negates MUI (do not use)', async () => {
      const v = await shadcnNotMuiPolicy.check(
        makeCtx({ briefMd: 'Do not use @mui/material; migrate to shadcn.' })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when brief uses "remove @mui/material"', async () => {
      const v = await shadcnNotMuiPolicy.check(
        makeCtx({ briefMd: 'Remove @mui/material imports.' })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when diff deletes MUI imports (lines start with -)', async () => {
      const v = await shadcnNotMuiPolicy.check(
        makeCtx({
          briefMd: 'Clean brief.',
          prDiff: "-import { Button } from '@mui/material';\n+import { Button } from '@/ui/button';"
        })
      );
      expect(v.ok).toBe(true);
    });
  });

  describe('fail cases', () => {
    it('fails on @mui/material import in PR diff', async () => {
      const v = await shadcnNotMuiPolicy.check(
        makeCtx({
          prDiff: "+import { Button } from '@mui/material';"
        })
      );
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.mode).toBe('hard-fail');
    });

    it('fails on @material-ui/core (v4) import', async () => {
      const v = await shadcnNotMuiPolicy.check(
        makeCtx({
          prDiff: "+import { Box } from '@material-ui/core';"
        })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on @mui/icons-material', async () => {
      const v = await shadcnNotMuiPolicy.check(
        makeCtx({ prDiff: "+import StarIcon from '@mui/icons-material/Star';" })
      );
      expect(v.ok).toBe(false);
    });

    it('fails when brief proposes adding @mui/material', async () => {
      const v = await shadcnNotMuiPolicy.check(
        makeCtx({ briefMd: 'Add @mui/material/Dialog to the modal.' })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on @material-ui/lab', async () => {
      const v = await shadcnNotMuiPolicy.check(
        makeCtx({ prDiff: "+import { Skeleton } from '@material-ui/lab';" })
      );
      expect(v.ok).toBe(false);
    });
  });

  describe('helpers', () => {
    it('findMuiImports skips deletion-only lines', () => {
      const e = findMuiImports("-import x from '@mui/material';", 'diff');
      expect(e).toHaveLength(0);
    });

    it('findMuiImports respects negative context', () => {
      const e = findMuiImports('avoid @mui/material at all costs', 'brief');
      expect(e).toHaveLength(0);
    });
  });

  describe('remediation', () => {
    it('suggestedFix mentions shadcn add command', async () => {
      const v = await shadcnNotMuiPolicy.check(
        makeCtx({ prDiff: "+import x from '@mui/material';" })
      );
      if (v.ok) throw new Error('expected fail');
      expect(v.suggestedFix).toMatch(/shadcn@latest add/);
    });
  });
});
