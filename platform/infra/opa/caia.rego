# CAIA policy bundle — publish gates for microfactories (Kernel-3, STOL-1034)
# v0 rego syntax (compatible with older OPA); we can migrate to v1 once we pin
# a newer image tag.

package caia.publish

import future.keywords.if
import future.keywords.contains
import future.keywords.in

default allow := false

allow if {
    input.budget.spent_usd <= input.budget.cap_usd
    not input.kill_switch.engaged
    count(input.evidence) > 0
}

deny_reasons contains msg if {
    input.budget.spent_usd > input.budget.cap_usd
    msg := sprintf("cost cap exceeded: %.2f > %.2f USD",
                   [input.budget.spent_usd, input.budget.cap_usd])
}

deny_reasons contains msg if {
    input.kill_switch.engaged
    msg := sprintf("kill-switch engaged for factory %v (reason=%v)",
                   [input.factory_id, input.kill_switch.reason])
}

deny_reasons contains "no evidence attached to publish envelope" if {
    count(input.evidence) == 0
}
