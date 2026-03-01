// src/views/GTDPanelWrapper.svelte
import "svelte/internal/disclose-version";
import * as $ from "svelte/internal/client";
import { untrack } from "svelte";
function GTDPanelWrapper($$anchor, $$props) {
  $.push($$props, true);
  let stable = $.rest_props($$props, [
    "$$slots",
    "$$events",
    "$$legacy",
    "bucketGroups",
    "settings",
    "onConfirm"
  ]);
  let bucketGroups = $.state($.proxy(untrack(() => $$props.bucketGroups)));
  let settings = $.state($.proxy(untrack(() => $$props.settings)));
  let onConfirm = $.state($.proxy(untrack(() => $$props.onConfirm)));
  function update(patch) {
    if (patch.bucketGroups !== void 0) $.set(bucketGroups, patch.bucketGroups, true);
    if (patch.settings !== void 0) $.set(settings, patch.settings, true);
    if (patch.onConfirm !== void 0) $.set(onConfirm, patch.onConfirm, true);
  }
  var $$exports = { update };
  GTDPanel($$anchor, {
    get bucketGroups() {
      return $.get(bucketGroups);
    },
    get settings() {
      return $.get(settings);
    },
    get onConfirm() {
      return $.get(onConfirm);
    },
    get onMove() {
      return $$props.onMove;
    },
    get onToggle() {
      return $$props.onToggle;
    },
    get onNavigate() {
      return $$props.onNavigate;
    },
    get onOpenSettings() {
      return $$props.onOpenSettings;
    },
    get celebrationImageUrls() {
      return $$props.celebrationImageUrls;
    }
  });
  return $.pop($$exports);
}
export {
  GTDPanelWrapper as default
};
