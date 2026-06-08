import assert from "node:assert/strict";
import { test } from "node:test";

import { latestRelease, releaseHistory, sectionEntries } from "./release.js";

test("release helpers expose latest release and filter empty sections", () => {
  const release = {
    latest: {
      version: "0.2.0",
      sections: {
        Added: ["新增版本弹窗"],
        Changed: [],
        Fixed: ["修复收藏反馈"]
      }
    },
    history: [{ version: "0.1.0" }]
  };

  assert.equal(latestRelease(release).version, "0.2.0");
  assert.deepEqual(releaseHistory(release), [{ version: "0.1.0" }]);
  assert.deepEqual(sectionEntries(release.latest.sections), [
    ["Added", ["新增版本弹窗"]],
    ["Fixed", ["修复收藏反馈"]]
  ]);
});
