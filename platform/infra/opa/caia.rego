# CAIA policy bundle — publish gates for microfactories (Kernel-3, STOL-1034)
#
# Every factory MUST call `data.caia.publish.allow` before emitting an artifact.
# Deny reasons are surfaced in the artifact envelope for observability.

package caia.publish

default allow := false

# Allow when: budget respected, kill-switch off, evidence attached
allow if {
    input.budget.spent_usd <= input.budget.cap_usd
    not input.kill_switch.engaged
    count(input.evidence) > 0
}

# Human-readable deny reasons
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
