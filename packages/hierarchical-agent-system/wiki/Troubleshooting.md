# Troubleshooting

Comprehensive troubleshooting guide for common issues in the CAIA Hierarchical Agent System.

---

## 🆘 Quick Help

### Emergency Commands
```bash
# System status check
caia-hierarchical status --detailed

# Health diagnostics  
caia-hierarchical test --health

# Reset configuration
caia-hierarchical config reset

# Clear cache
rm -rf ~/.config/caia-hierarchical/cache
```

---

## Installation Issues

### Command Not Found

**Problem**: `caia-hierarchical: command not found`

**Solutions**:
```bash
# Check if installed globally
npm list -g @caia/hierarchical-agent-system

# Reinstall globally
npm uninstall -g @caia/hierarchical-agent-system
npm install -g @caia/hierarchical-agent-system

# Fix PATH issues
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Permission Errors

**Problem**: `EACCES: permission denied`

**Solutions**:
```bash
# Fix npm permissions (macOS/Linux)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH

# Windows: Run as Administrator
# PowerShell: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Node.js Version Issues

**Problem**: Incompatible Node.js version

**Solutions**:
```bash
# Check version
node --version
# Must be >= 18.0.0

# Update Node.js
# macOS: brew upgrade node
# Windows: Download from nodejs.org
# Linux: Use NodeSource repository
```

---

## Configuration Issues

### Invalid Configuration

**Problem**: Configuration validation failed

**Solutions**:
```bash
# Validate current config
caia-hierarchical config validate

# Show configuration
caia-hierarchical config show --verbose

# Reset to defaults
caia-hierarchical config reset

# Reinitialize
caia-hierarchical init --force
```

### Environment Variables

**Problem**: Environment variables not loaded

**Solutions**:
```bash
# Check environment
echo $JIRA_HOST_URL
echo $JIRA_USERNAME
echo $JIRA_API_TOKEN

# Reload environment
source .env
# or
export $(cat .env | xargs)

# Verify in application
caia-hierarchical config show --section jira
```

---

## JIRA Integration Issues

### Authentication Failures

**Problem**: `401 Unauthorized`

**Diagnostics**:
```bash
# Test JIRA connection
curl -u "email@company.com:api-token" \
  "https://company.atlassian.net/rest/api/3/myself"
```

**Solutions**:
- Verify email address is correct
- Generate new API token
- Check token hasn't expired
- Verify account has JIRA access

### Permission Errors

**Problem**: `403 Forbidden`

**Solutions**:
```bash
# Check project permissions
caia-hierarchical test --jira --verbose

# Required permissions:
# - Browse Project
# - Create Issues
# - Edit Issues  
# - Link Issues
```

### Rate Limiting

**Problem**: `429 Too Many Requests`

**Solutions**:
- Reduce batch size: `JIRA_MAX_BATCH_SIZE=25`
- Increase delays: `JIRA_RATE_LIMIT=50`
- Use connection pooling
- Implement exponential backoff

### Custom Fields Not Found

**Problem**: Custom field errors

**Solutions**:
```bash
# List available fields
curl -u "email:token" \
  "https://company.atlassian.net/rest/api/3/field"

# Update configuration
caia-hierarchical config set jiraConnect.customFields.storyPoints "customfield_10001"
```

---

## Performance Issues

### Slow Processing

**Problem**: Very slow project processing

**Solutions**:
```bash
# Check system resources
caia-hierarchical status --metrics

# Increase concurrency
export CAIA_MAX_CONCURRENCY=20

# Enable parallel processing
export CAIA_ENABLE_PARALLEL=true

# Lower quality threshold for speed
export CAIA_QUALITY_THRESHOLD=0.75
```

### Memory Issues

**Problem**: Out of memory errors

**Solutions**:
```bash
# Increase Node.js memory
export NODE_OPTIONS="--max-old-space-size=4096"

# Enable garbage collection
node --expose-gc dist/index.js

# Process in smaller batches
export CAIA_BATCH_SIZE=25
```

### High CPU Usage

**Solutions**:
```bash
# Limit concurrency
export CAIA_MAX_CONCURRENCY=5

# Reduce worker threads
export UV_THREADPOOL_SIZE=4

# Enable throttling
export CAIA_ENABLE_THROTTLING=true
```

---

## Processing Errors

### Task Decomposition Failures

**Problem**: Low confidence scores or failed decomposition

**Solutions**:
```bash
# Lower quality threshold
caia-hierarchical config set taskDecomposer.qualityGateThreshold 0.75

# Increase rework cycles
caia-hierarchical config set taskDecomposer.maxReworkCycles 5

# Enable debug mode
caia-hierarchical process "your idea" --debug
```

### Intelligence Analysis Errors

**Problem**: Analysis failures or poor predictions

**Solutions**:
```bash
# Clear intelligence cache
rm -rf ~/.config/caia-hierarchical/intelligence-data

# Disable analytics temporarily
export ENABLE_ANALYTICS=false

# Reset intelligence models
caia-hierarchical config set intelligence.enableAnalytics false
```

---

## Network & Connectivity Issues

### Proxy Configuration

**Problem**: Corporate proxy blocking requests

**Solutions**:
```bash
# Configure npm proxy
npm config set proxy http://proxy.company.com:8080
npm config set https-proxy http://proxy.company.com:8080

# Set environment variables
export HTTP_PROXY=http://proxy.company.com:8080
export HTTPS_PROXY=http://proxy.company.com:8080
export NO_PROXY=localhost,127.0.0.1
```

### SSL Certificate Issues

**Problem**: SSL certificate errors

**Solutions**:
```bash
# Temporary: Disable SSL verification (NOT for production)
export NODE_TLS_REJECT_UNAUTHORIZED=0

# Better: Add certificate to Node.js
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.crt
```

### DNS Issues

**Problem**: Cannot resolve hostnames

**Solutions**:
```bash
# Test DNS resolution
nslookup company.atlassian.net

# Use IP addresses temporarily
# Update /etc/hosts if needed
```

---

## Data & File Issues

### File Permission Errors

**Problem**: Cannot write to directories

**Solutions**:
```bash
# Fix permissions
sudo chown -R $USER:$USER ~/.config/caia-hierarchical
chmod -R 755 ~/.config/caia-hierarchical

# Use different directory
export CAIA_CONFIG_DIR=~/caia-config
export CAIA_DATA_DIR=~/caia-data
```

### Disk Space Issues

**Problem**: Insufficient disk space

**Solutions**:
```bash
# Check disk space
df -h

# Clean up logs
find ~/.config/caia-hierarchical/logs -name "*.log" -older-than 7d -delete

# Clean cache
rm -rf ~/.config/caia-hierarchical/cache
```

---

## Debugging Techniques

### Enable Debug Mode

```bash
# Debug specific component
caia-hierarchical process "test" --debug

# Debug with verbose output
DEBUG=* caia-hierarchical process "test"

# Component-specific debugging
DEBUG=hierarchical:jira caia-hierarchical process "test"
```

### Log Analysis

```bash
# View recent logs
tail -f ~/.config/caia-hierarchical/logs/debug.log

# Search for errors
grep -i error ~/.config/caia-hierarchical/logs/*.log

# Search for specific component
grep "TaskDecomposer" ~/.config/caia-hierarchical/logs/*.log
```

### Performance Analysis

```bash
# Profile performance
node --prof dist/index.js
node --prof-process isolate-*.log > profile.txt

# Memory profiling
node --inspect dist/index.js
# Then connect with Chrome DevTools
```

---

## Getting Help

### Self-Diagnostics

```bash
# Comprehensive health check
caia-hierarchical test --all --verbose

# System information
caia-hierarchical --version --verbose

# Configuration dump
caia-hierarchical config show --all > config-dump.json
```

### Community Support

- **GitHub Issues**: [Report bugs](https://github.com/caia-team/hierarchical-agent-system/issues)
- **Discussions**: [Community Q&A](https://github.com/caia-team/hierarchical-agent-system/discussions)
- **Discord**: [Real-time support](https://discord.gg/caia-dev)
- **Stack Overflow**: Tag `caia-hierarchical`

### Enterprise Support

- **Email**: support@caia.dev
- **Priority Support**: Available with enterprise license
- **Custom Training**: Available for teams

---

## Error Reference

### Common Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| `EAUTH001` | JIRA authentication failed | Check credentials |
| `ECONF001` | Configuration invalid | Run `config validate` |
| `ENET001` | Network connection failed | Check proxy/firewall |
| `EMEM001` | Out of memory | Increase heap size |
| `EQUAL001` | Quality gate failed | Lower threshold or improve input |
| `EPROC001` | Processing timeout | Increase timeout values |

---

## Prevention Tips

### Best Practices

1. **Regular Updates**: Keep the system updated
2. **Configuration Backup**: Backup configuration regularly
3. **Monitor Resources**: Watch memory and CPU usage
4. **Test Integration**: Verify JIRA connectivity regularly
5. **Log Rotation**: Set up log rotation to prevent disk issues
6. **Health Checks**: Run periodic health checks

### Monitoring Setup

```bash
# Set up monitoring cron job
echo "0 */6 * * * /usr/local/bin/caia-hierarchical status --json >> /var/log/caia-health.log" | crontab -

# Alert on failures
echo "0 */1 * * * /usr/local/bin/caia-hierarchical test --health --quiet || echo 'CAIA health check failed' | mail admin@company.com" | crontab -
```

By following this troubleshooting guide, most issues can be quickly identified and resolved. For complex problems, the debugging techniques and support channels provide additional assistance.