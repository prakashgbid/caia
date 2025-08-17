# Jira Admin Permissions & Configuration Requirements

## 🔐 Permission Levels Required for Jira Administration

### 1. **Project-Level Permissions**
These can be managed by Project Administrators:

#### **Basic Project Administration**
- ✅ **Browse Projects** - View project and issues
- ✅ **Create Issues** - Create new issues in project
- ✅ **Edit Issues** - Modify existing issues
- ✅ **Assign Issues** - Assign to team members
- ✅ **Delete Issues** - Remove issues (careful!)
- ✅ **Link Issues** - Create issue relationships

#### **Project Configuration** (Project Admin Required)
- ✅ **Modify Project Settings** - Change project details
- ✅ **Configure Issue Types** - Add/remove Epic, Story, Task, etc.
- ✅ **Manage Versions** - Create and manage releases
- ✅ **Manage Components** - Organize project structure
- ✅ **Configure Workflows** - Modify issue transitions
- ✅ **Setup Automation Rules** - Create project automation
- ✅ **Configure Screens** - Customize issue forms
- ✅ **Manage Custom Fields** - Add project-specific fields

### 2. **Jira Administrator Permissions**
These require Jira Administrator or Site Admin role:

#### **Global Configuration**
- 🔒 **User Management** - Add/remove users
- 🔒 **Global Permissions** - Set site-wide permissions
- 🔒 **Application Access** - Control who can use Jira
- 🔒 **System Settings** - Configure Jira instance
- 🔒 **License Management** - Manage Jira licenses

#### **Advanced Configuration**
- 🔒 **Issue Type Schemes** - Create global issue types
- 🔒 **Workflow Schemes** - Define workflow templates
- 🔒 **Permission Schemes** - Create permission templates
- 🔒 **Field Configuration Schemes** - Global field management
- 🔒 **Screen Schemes** - Global screen templates
- 🔒 **Issue Security Schemes** - Control issue visibility

### 3. **Site Administrator Permissions**
Highest level - Atlassian Organization Admin:

- 🔴 **Billing Management** - Subscription and payments
- 🔴 **Product Access** - Enable/disable products
- 🔴 **Organization Settings** - Company-wide settings
- 🔴 **Security Policies** - 2FA, SSO, IP restrictions
- 🔴 **Audit Logs** - Access to all activity logs
- 🔴 **Data Management** - Import/export, backup

## 📊 Permission Matrix for Common Tasks

| Task | Project Admin | Jira Admin | Site Admin | API Possible |
|------|--------------|------------|------------|--------------|
| Create Issues | ✅ | ✅ | ✅ | ✅ |
| Add Issue Types to Project | ✅ | ✅ | ✅ | ✅ |
| Create New Issue Type | ❌ | ✅ | ✅ | ✅ |
| Modify Workflow | ✅* | ✅ | ✅ | ✅ |
| Create Custom Fields | ✅* | ✅ | ✅ | ✅ |
| Add Users | ❌ | ✅ | ✅ | ⚠️ |
| Create Projects | ❌ | ✅ | ✅ | ✅ |
| Install Apps/Plugins | ❌ | ❌ | ✅ | ❌ |
| Configure Automation | ✅ | ✅ | ✅ | ✅ |
| Set Permissions | ✅* | ✅ | ✅ | ✅ |

*Limited to project scope

## 🤖 API Capabilities vs UI-Only Tasks

### ✅ **Can Be Done via API:**
- Create/update/delete issues
- Manage issue types (if permissions exist)
- Create/update projects
- Manage versions and components
- Set field values
- Create links and dependencies
- Execute JQL queries
- Trigger automation rules
- Manage sprints (Jira Software)
- Create/update filters and dashboards

### ❌ **Cannot Be Done via API (UI Required):**
- Install Marketplace apps
- Configure SSO/SAML
- Manage billing
- Some advanced permission schemes
- Complex workflow designer actions
- Some screen configuration tasks
- License management
- Some security settings

## 🔑 Minimum Permissions for Jira Admin Agent

### **Required Permissions:**
```json
{
  "projectPermissions": [
    "BROWSE_PROJECTS",
    "CREATE_ISSUES",
    "EDIT_ISSUES",
    "ASSIGN_ISSUES",
    "LINK_ISSUES",
    "MOVE_ISSUES",
    "SCHEDULE_ISSUES",
    "RESOLVE_ISSUES",
    "CLOSE_ISSUES",
    "MODIFY_REPORTER",
    "DELETE_ISSUES",
    "ASSIGNABLE_USER",
    "TRANSITION_ISSUES",
    "ADD_COMMENTS",
    "EDIT_ALL_COMMENTS",
    "DELETE_ALL_COMMENTS",
    "CREATE_ATTACHMENTS",
    "DELETE_ALL_ATTACHMENTS",
    "WORK_ON_ISSUES",
    "MANAGE_SPRINTS"
  ],
  "globalPermissions": [
    "ADMINISTER_PROJECTS",
    "BROWSE_USERS",
    "CREATE_SHARED_OBJECTS",
    "MANAGE_GROUP_FILTER_SUBSCRIPTIONS",
    "BULK_CHANGE"
  ],
  "applicationRoles": [
    "jira-software"
  ]
}
```

### **Ideal Permissions (Full Admin):**
```json
{
  "globalPermissions": [
    "ADMINISTER",  // Full Jira Admin
    "SYSTEM_ADMIN" // Site Admin (rare)
  ]
}
```

## 📝 How to Check Current Permissions

### Via API:
```javascript
// Check my permissions
GET /rest/api/3/mypermissions

// Check project permissions
GET /rest/api/3/user/permission/search?projectKey=PARA

// Check if admin
GET /rest/api/3/myself
// Look for: groups.items[].name contains "administrators"
```

### Via UI:
1. **Profile** → Settings → Personal Settings
2. **Project** → Project Settings → Permissions
3. **Jira Settings** ⚙️ → System → Global Permissions

## 🎯 Recommended Setup for Jira Admin Agent

### **Minimum Viable Setup:**
1. Create dedicated service account
2. Grant **Project Administrator** role for managed projects
3. Add to **jira-administrators** group (if possible)

### **Ideal Setup:**
1. Service account with Jira Administrator role
2. API token with no expiry
3. Audit logging enabled
4. Restricted to specific IP ranges (optional)

## 🚨 Security Considerations

### **Best Practices:**
- Use service accounts, not personal accounts
- Rotate API tokens regularly
- Audit admin actions
- Limit scope to necessary projects
- Use OAuth 2.0 when possible
- Enable 2FA for admin accounts
- Monitor API usage

### **Risk Levels:**
- 🟢 **Low Risk**: Read-only operations
- 🟡 **Medium Risk**: Issue creation/modification
- 🟠 **High Risk**: Workflow/permission changes
- 🔴 **Critical Risk**: User management, billing access

## 📋 Checklist for Jira Admin Agent Implementation

- [ ] Determine required permission scope
- [ ] Create service account
- [ ] Generate API token
- [ ] Grant appropriate permissions
- [ ] Test permission levels
- [ ] Implement permission checking in agent
- [ ] Add audit logging
- [ ] Create rollback mechanisms
- [ ] Document available operations
- [ ] Set up monitoring/alerts

---

**Note**: Always follow principle of least privilege - grant only the minimum permissions necessary for the agent to function.