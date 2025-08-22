#!/usr/bin/env python3
"""
Vendor Integration Manager Agent
Manages all third-party service integrations, credentials, and health monitoring
"""

import json
import os
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from pathlib import Path
import hashlib
import base64

class VendorIntegrationManagerAgent:
    """
    Manages all vendor integrations for Roulette Community
    """
    
    def __init__(self, project_path: str = "/Users/MAC/Documents/projects/roulette-community"):
        self.project_path = Path(project_path)
        self.vendors = self._initialize_vendors()
        self.health_status = {}
        self.usage_tracking = {}
        self.credentials = {}
        self.integration_config_file = self.project_path / ".vendors" / "integrations.json"
        
    def _initialize_vendors(self) -> Dict:
        """
        Initialize vendor registry with all services used in Roulette Community
        """
        return {
            'supabase': {
                'name': 'Supabase',
                'category': 'database_auth',
                'tier': 'free',
                'status': 'inactive',
                'required_env_vars': [
                    'NEXT_PUBLIC_SUPABASE_URL',
                    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                    'SUPABASE_SERVICE_ROLE_KEY'
                ],
                'limits': {
                    'database': '500MB',
                    'storage': '1GB',
                    'bandwidth': '2GB',
                    'mau': 50000,
                    'edge_functions': 500000
                },
                'documentation': 'https://supabase.com/docs',
                'health_check_endpoint': '/api/health',
                'critical': True
            },
            'stripe': {
                'name': 'Stripe',
                'category': 'payments',
                'tier': 'free_test',
                'status': 'inactive',
                'required_env_vars': [
                    'STRIPE_SECRET_KEY',
                    'STRIPE_PUBLISHABLE_KEY',
                    'STRIPE_WEBHOOK_SECRET'
                ],
                'limits': {
                    'test_mode': 'unlimited',
                    'live_mode_fee': '2.9% + 30¢'
                },
                'documentation': 'https://stripe.com/docs',
                'critical': False
            },
            'vercel': {
                'name': 'Vercel',
                'category': 'deployment',
                'tier': 'hobby',
                'status': 'inactive',
                'required_env_vars': [
                    'VERCEL_TOKEN',
                    'VERCEL_PROJECT_ID',
                    'VERCEL_ORG_ID'
                ],
                'limits': {
                    'bandwidth': '100GB/month',
                    'serverless_functions': '12 seconds timeout',
                    'deployments': '100/day',
                    'team_members': 1,
                    'domains': 'unlimited'
                },
                'documentation': 'https://vercel.com/docs',
                'critical': True
            },
            'sentry': {
                'name': 'Sentry',
                'category': 'monitoring',
                'tier': 'developer',
                'status': 'inactive',
                'required_env_vars': [
                    'SENTRY_DSN',
                    'SENTRY_AUTH_TOKEN'
                ],
                'limits': {
                    'errors': '5000/month',
                    'performance_monitoring': '10000/month',
                    'replays': '500/month',
                    'team_members': 1
                },
                'documentation': 'https://docs.sentry.io',
                'critical': False
            },
            'cloudinary': {
                'name': 'Cloudinary',
                'category': 'media',
                'tier': 'free',
                'status': 'inactive',
                'required_env_vars': [
                    'CLOUDINARY_CLOUD_NAME',
                    'CLOUDINARY_API_KEY',
                    'CLOUDINARY_API_SECRET'
                ],
                'limits': {
                    'storage': '25GB',
                    'bandwidth': '25GB/month',
                    'transformations': '25000/month'
                },
                'documentation': 'https://cloudinary.com/documentation',
                'critical': False
            },
            'contentful': {
                'name': 'Contentful',
                'category': 'cms',
                'tier': 'community',
                'status': 'inactive',
                'required_env_vars': [
                    'CONTENTFUL_SPACE_ID',
                    'CONTENTFUL_ACCESS_TOKEN',
                    'CONTENTFUL_PREVIEW_TOKEN'
                ],
                'limits': {
                    'spaces': 1,
                    'locales': 2,
                    'users': 5,
                    'api_calls': '1M/month'
                },
                'documentation': 'https://www.contentful.com/developers/docs/',
                'critical': False
            },
            'upstash': {
                'name': 'Upstash Redis',
                'category': 'caching',
                'tier': 'free',
                'status': 'inactive',
                'required_env_vars': [
                    'UPSTASH_REDIS_REST_URL',
                    'UPSTASH_REDIS_REST_TOKEN'
                ],
                'limits': {
                    'requests': '10000/day',
                    'bandwidth': '1GB/month',
                    'max_db_size': '256MB'
                },
                'documentation': 'https://docs.upstash.com',
                'critical': False
            },
            'resend': {
                'name': 'Resend',
                'category': 'email',
                'tier': 'free',
                'status': 'inactive',
                'required_env_vars': [
                    'RESEND_API_KEY',
                    'RESEND_FROM_EMAIL'
                ],
                'limits': {
                    'emails': '100/day',
                    'domains': 1
                },
                'documentation': 'https://resend.com/docs',
                'critical': False
            },
            'unleash': {
                'name': 'Unleash',
                'category': 'feature_flags',
                'tier': 'open_source',
                'status': 'inactive',
                'required_env_vars': [
                    'UNLEASH_API_URL',
                    'UNLEASH_CLIENT_KEY',
                    'UNLEASH_INSTANCE_ID'
                ],
                'limits': {
                    'flags': 'unlimited',
                    'environments': 'unlimited',
                    'users': 'unlimited'
                },
                'documentation': 'https://docs.getunleash.io',
                'critical': False
            },
            'github': {
                'name': 'GitHub',
                'category': 'version_control',
                'tier': 'free',
                'status': 'inactive',
                'required_env_vars': [
                    'GITHUB_TOKEN',
                    'GITHUB_REPO',
                    'GITHUB_OWNER'
                ],
                'limits': {
                    'actions_minutes': '2000/month',
                    'storage': '500MB',
                    'bandwidth': '1GB/month'
                },
                'documentation': 'https://docs.github.com',
                'critical': True
            },
            'cloudflare': {
                'name': 'Cloudflare',
                'category': 'cdn_workers',
                'tier': 'free',
                'status': 'inactive',
                'required_env_vars': [
                    'CLOUDFLARE_API_TOKEN',
                    'CLOUDFLARE_ACCOUNT_ID'
                ],
                'limits': {
                    'workers_requests': '100000/day',
                    'workers_cpu': '10ms/request',
                    'kv_reads': '100000/day',
                    'kv_writes': '1000/day'
                },
                'documentation': 'https://developers.cloudflare.com',
                'critical': False
            }
        }
    
    def check_integration_status(self) -> Dict:
        """
        Check the status of all vendor integrations
        """
        status_report = {
            'timestamp': datetime.now().isoformat(),
            'integrations': [],
            'summary': {
                'total': len(self.vendors),
                'active': 0,
                'partial': 0,
                'inactive': 0,
                'error': 0
            }
        }
        
        for vendor_id, vendor in self.vendors.items():
            integration_status = self._check_single_integration(vendor_id, vendor)
            status_report['integrations'].append(integration_status)
            
            # Update summary
            status = integration_status['status']
            if status in status_report['summary']:
                status_report['summary'][status] += 1
        
        return status_report
    
    def _check_single_integration(self, vendor_id: str, vendor: Dict) -> Dict:
        """
        Check status of a single integration
        """
        env_vars_present = []
        env_vars_missing = []
        
        # Check environment variables
        for env_var in vendor['required_env_vars']:
            if os.getenv(env_var):
                env_vars_present.append(env_var)
            else:
                env_vars_missing.append(env_var)
        
        # Determine status
        if not env_vars_missing:
            status = 'active'
            details = f"All {len(env_vars_present)} required environment variables are configured"
        elif env_vars_present:
            status = 'partial'
            details = f"{len(env_vars_present)} of {len(vendor['required_env_vars'])} variables configured"
        else:
            status = 'inactive'
            details = "No environment variables configured"
        
        # Check for critical services
        if vendor.get('critical') and status != 'active':
            status = 'error'
            details = f"CRITICAL SERVICE NOT CONFIGURED: {details}"
        
        return {
            'name': vendor['name'],
            'vendor_id': vendor_id,
            'category': vendor['category'],
            'status': status,
            'configured': status == 'active',
            'details': details,
            'envVarsPresent': env_vars_present,
            'envVarsMissing': env_vars_missing,
            'tier': vendor['tier'],
            'limits': vendor.get('limits', {}),
            'critical': vendor.get('critical', False)
        }
    
    def setup_integration(self, vendor_id: str, credentials: Dict) -> Dict:
        """
        Setup a vendor integration with provided credentials
        """
        if vendor_id not in self.vendors:
            return {
                'success': False,
                'error': f"Unknown vendor: {vendor_id}"
            }
        
        vendor = self.vendors[vendor_id]
        
        # Create .env.local file if it doesn't exist
        env_file = self.project_path / '.env.local'
        env_lines = []
        
        if env_file.exists():
            with open(env_file, 'r') as f:
                env_lines = f.readlines()
        
        # Update or add environment variables
        for env_var in vendor['required_env_vars']:
            if env_var in credentials:
                # Remove existing line if present
                env_lines = [line for line in env_lines if not line.startswith(f"{env_var}=")]
                # Add new line
                env_lines.append(f"{env_var}={credentials[env_var]}\n")
        
        # Write back to file
        with open(env_file, 'w') as f:
            f.writelines(env_lines)
        
        # Update vendor status
        self.vendors[vendor_id]['status'] = 'active'
        
        return {
            'success': True,
            'vendor': vendor_id,
            'message': f"Successfully configured {vendor['name']}"
        }
    
    def test_integration(self, vendor_id: str) -> Dict:
        """
        Test a specific vendor integration
        """
        if vendor_id not in self.vendors:
            return {
                'success': False,
                'error': f"Unknown vendor: {vendor_id}"
            }
        
        vendor = self.vendors[vendor_id]
        test_results = {
            'vendor': vendor_id,
            'name': vendor['name'],
            'timestamp': datetime.now().isoformat(),
            'tests': []
        }
        
        # Check environment variables
        env_test = {
            'test': 'Environment Variables',
            'passed': all(os.getenv(var) for var in vendor['required_env_vars']),
            'details': f"Checked {len(vendor['required_env_vars'])} variables"
        }
        test_results['tests'].append(env_test)
        
        # Vendor-specific tests
        if vendor_id == 'supabase':
            test_results['tests'].append(self._test_supabase())
        elif vendor_id == 'vercel':
            test_results['tests'].append(self._test_vercel())
        elif vendor_id == 'github':
            test_results['tests'].append(self._test_github())
        
        # Overall success
        test_results['success'] = all(test['passed'] for test in test_results['tests'])
        
        return test_results
    
    def _test_supabase(self) -> Dict:
        """Test Supabase connection"""
        try:
            url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
            if url:
                # Simple connectivity test
                import urllib.request
                response = urllib.request.urlopen(f"{url}/rest/v1/")
                return {
                    'test': 'Supabase Connectivity',
                    'passed': response.status == 200,
                    'details': 'API endpoint reachable'
                }
        except Exception as e:
            return {
                'test': 'Supabase Connectivity',
                'passed': False,
                'details': str(e)
            }
        
        return {
            'test': 'Supabase Connectivity',
            'passed': False,
            'details': 'No URL configured'
        }
    
    def _test_vercel(self) -> Dict:
        """Test Vercel configuration"""
        token = os.getenv('VERCEL_TOKEN')
        return {
            'test': 'Vercel Configuration',
            'passed': bool(token),
            'details': 'Token configured' if token else 'Token missing'
        }
    
    def _test_github(self) -> Dict:
        """Test GitHub configuration"""
        token = os.getenv('GITHUB_TOKEN')
        return {
            'test': 'GitHub Configuration',
            'passed': bool(token),
            'details': 'Token configured' if token else 'Token missing'
        }
    
    def track_usage(self, vendor_id: str, metric: str, value: float) -> None:
        """
        Track usage metrics for vendors to avoid hitting limits
        """
        if vendor_id not in self.usage_tracking:
            self.usage_tracking[vendor_id] = {}
        
        if metric not in self.usage_tracking[vendor_id]:
            self.usage_tracking[vendor_id][metric] = {
                'current': 0,
                'history': []
            }
        
        self.usage_tracking[vendor_id][metric]['current'] += value
        self.usage_tracking[vendor_id][metric]['history'].append({
            'timestamp': datetime.now().isoformat(),
            'value': value
        })
    
    def check_limits(self, vendor_id: str) -> Dict:
        """
        Check if approaching vendor limits
        """
        if vendor_id not in self.vendors:
            return {'error': 'Unknown vendor'}
        
        vendor = self.vendors[vendor_id]
        limits = vendor.get('limits', {})
        usage = self.usage_tracking.get(vendor_id, {})
        
        warnings = []
        for metric, limit in limits.items():
            if metric in usage:
                current = usage[metric].get('current', 0)
                # Parse limit if it's a string with number
                if isinstance(limit, str):
                    import re
                    match = re.search(r'(\d+)', limit)
                    if match:
                        limit_value = int(match.group(1))
                        if current > limit_value * 0.8:  # 80% threshold
                            warnings.append({
                                'metric': metric,
                                'current': current,
                                'limit': limit,
                                'percentage': (current / limit_value) * 100
                            })
        
        return {
            'vendor': vendor_id,
            'warnings': warnings,
            'safe': len(warnings) == 0
        }
    
    def suggest_alternatives(self, vendor_id: str) -> List[Dict]:
        """
        Suggest alternative vendors if one is down or hitting limits
        """
        if vendor_id not in self.vendors:
            return []
        
        category = self.vendors[vendor_id]['category']
        alternatives = []
        
        # Category-based alternatives
        alternative_map = {
            'database_auth': ['firebase', 'appwrite', 'mongodb_atlas'],
            'payments': ['paddle', 'lemonsqueezy', 'paypal'],
            'deployment': ['netlify', 'railway', 'render'],
            'monitoring': ['logflare', 'logrocket', 'bugsnag'],
            'email': ['sendgrid', 'mailgun', 'postmark'],
            'caching': ['redis_labs', 'memcached_cloud'],
            'cdn_workers': ['fastly', 'bunny_cdn'],
            'cms': ['strapi', 'sanity', 'directus']
        }
        
        if category in alternative_map:
            for alt in alternative_map[category]:
                alternatives.append({
                    'name': alt,
                    'category': category,
                    'free_tier': True,
                    'migration_difficulty': 'medium'
                })
        
        return alternatives
    
    def generate_integration_report(self) -> str:
        """
        Generate a comprehensive integration report
        """
        status = self.check_integration_status()
        
        report = []
        report.append("=" * 60)
        report.append("VENDOR INTEGRATION REPORT")
        report.append("=" * 60)
        report.append(f"Generated: {status['timestamp']}")
        report.append("")
        
        # Summary
        report.append("SUMMARY")
        report.append("-" * 30)
        for key, value in status['summary'].items():
            report.append(f"{key.capitalize()}: {value}")
        report.append("")
        
        # Critical Services
        report.append("CRITICAL SERVICES")
        report.append("-" * 30)
        critical = [i for i in status['integrations'] if i.get('critical')]
        for integration in critical:
            status_icon = "✅" if integration['status'] == 'active' else "❌"
            report.append(f"{status_icon} {integration['name']}: {integration['status']}")
        report.append("")
        
        # Detailed Status
        report.append("DETAILED STATUS")
        report.append("-" * 30)
        for integration in status['integrations']:
            report.append(f"\n{integration['name']} ({integration['vendor_id']})")
            report.append(f"  Status: {integration['status']}")
            report.append(f"  Category: {integration['category']}")
            report.append(f"  Tier: {integration['tier']}")
            
            if integration['envVarsMissing']:
                report.append(f"  Missing: {', '.join(integration['envVarsMissing'])}")
        
        report.append("")
        report.append("=" * 60)
        
        return "\n".join(report)
    
    def save_configuration(self) -> None:
        """
        Save current integration configuration
        """
        config_dir = self.project_path / ".vendors"
        config_dir.mkdir(exist_ok=True)
        
        config = {
            'vendors': self.vendors,
            'usage': self.usage_tracking,
            'last_updated': datetime.now().isoformat()
        }
        
        with open(self.integration_config_file, 'w') as f:
            json.dump(config, f, indent=2)
    
    def load_configuration(self) -> None:
        """
        Load saved integration configuration
        """
        if self.integration_config_file.exists():
            with open(self.integration_config_file, 'r') as f:
                config = json.load(f)
                self.vendors = config.get('vendors', self.vendors)
                self.usage_tracking = config.get('usage', {})


if __name__ == "__main__":
    # Test the integration manager
    manager = VendorIntegrationManagerAgent()
    
    # Check status
    status = manager.check_integration_status()
    print(f"Total Integrations: {status['summary']['total']}")
    print(f"Active: {status['summary']['active']}")
    print(f"Inactive: {status['summary']['inactive']}")
    
    # Generate report
    report = manager.generate_integration_report()
    print(report)
    
    # Save configuration
    manager.save_configuration()
    print("\n✅ Vendor Integration Manager initialized!")