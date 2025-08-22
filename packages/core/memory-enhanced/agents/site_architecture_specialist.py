"""
Site Architecture Specialist Agent for Roulette Community
Manages sitemap, URL schemas, feature mapping, and navigation architecture
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
import json

@dataclass
class Route:
    """Represents a single route in the application"""
    path: str
    feature: str
    title: str
    description: str
    auth_required: bool
    priority: float  # SEO priority 0.0-1.0
    changefreq: str  # daily, weekly, monthly
    children: List['Route'] = None
    api_endpoints: List[str] = None
    components: List[str] = None
    metadata: Dict = None

class SiteArchitectureSpecialist:
    """
    Specialist agent for managing site architecture, URL schemas, and feature mapping
    """
    
    def __init__(self):
        self.name = "Site Architecture Specialist"
        self.role = "URL Schema Designer & Navigation Architect"
        self.expertise = [
            "Sitemap generation",
            "URL schema design",
            "Feature-to-route mapping",
            "Navigation hierarchy",
            "SEO optimization",
            "Deep linking strategy",
            "Information architecture"
        ]
        
        # Initialize with existing Roulette Community structure
        self.existing_routes = self._map_existing_routes()
        self.url_patterns = self._define_url_patterns()
        self.feature_map = self._create_feature_map()
        
    def _map_existing_routes(self) -> Dict[str, Route]:
        """Map all existing routes from the current project structure"""
        return {
            # Public Routes
            "/": Route(
                path="/",
                feature="landing",
                title="Roulette Community - Premium Gaming Platform",
                description="Experience the ultimate roulette gaming with community features",
                auth_required=False,
                priority=1.0,
                changefreq="daily",
                api_endpoints=["/api/health"],
                components=["Header", "Footer", "Hero", "Features"]
            ),
            
            # Authentication Routes
            "/auth/login": Route(
                path="/auth/login",
                feature="authentication",
                title="Login - Roulette Community",
                description="Sign in to your account",
                auth_required=False,
                priority=0.8,
                changefreq="monthly",
                api_endpoints=["/api/auth/login", "/api/auth/verify-captcha"],
                components=["LoginForm", "SocialAuth", "CaptchaVerification"]
            ),
            "/auth/signup": Route(
                path="/auth/signup",
                feature="authentication",
                title="Sign Up - Join Roulette Community",
                description="Create your free account and get started",
                auth_required=False,
                priority=0.9,
                changefreq="monthly",
                api_endpoints=["/api/auth/register"],
                components=["SignupForm", "ReferralCode", "TermsAcceptance"]
            ),
            "/auth/error": Route(
                path="/auth/error",
                feature="authentication",
                title="Authentication Error",
                description="Error during authentication",
                auth_required=False,
                priority=0.1,
                changefreq="yearly",
                components=["ErrorDisplay", "RetryOptions"]
            ),
            
            # Gaming Routes
            "/play": Route(
                path="/play",
                feature="gaming",
                title="Play American Roulette - Live Tables",
                description="Join live American roulette tables with double zero",
                auth_required=True,
                priority=0.9,
                changefreq="always",
                api_endpoints=[
                    "/api/game/session",
                    "/api/game/bet",
                    "/api/game/history",
                    "/api/game/rng/verify"
                ],
                components=[
                    "RouletteWheel",
                    "BettingTable",
                    "BettingControls",
                    "GameBoard",
                    "GameHeader",
                    "GameSidebar",
                    "DelightfulMoments",
                    "ShareableMoments"
                ],
                metadata={"table_type": "american", "double_zero": True}
            ),
            
            # Dashboard Routes
            "/dashboard": Route(
                path="/dashboard",
                feature="user_dashboard",
                title="Dashboard - Your Gaming Hub",
                description="View your stats, achievements, and activity",
                auth_required=True,
                priority=0.7,
                changefreq="daily",
                api_endpoints=[
                    "/api/session",
                    "/api/currency/balance",
                    "/api/currency/transactions"
                ],
                components=["ExperimentDashboard", "StatsOverview", "RecentActivity"]
            ),
            
            # Learning Routes
            "/learn": Route(
                path="/learn",
                feature="education",
                title="Roulette Academy - Learn & Master",
                description="Comprehensive roulette education and strategy guides",
                auth_required=False,
                priority=0.8,
                changefreq="weekly",
                components=[
                    "LearningAcademy",
                    "CourseCatalog",
                    "StrategyLibrary",
                    "InteractiveModule"
                ]
            ),
            
            # Admin Routes
            "/admin": Route(
                path="/admin",
                feature="administration",
                title="Admin Panel",
                description="System administration",
                auth_required=True,
                priority=0.1,
                changefreq="monthly",
                children=[
                    Route(
                        path="/admin/integrations",
                        feature="admin_integrations",
                        title="Integration Management",
                        description="Manage third-party integrations",
                        auth_required=True,
                        priority=0.1,
                        changefreq="monthly",
                        api_endpoints=["/api/admin/integration-status"]
                    )
                ]
            )
        }
    
    def _define_url_patterns(self) -> Dict[str, str]:
        """Define URL naming patterns and conventions"""
        return {
            # Core patterns
            "public_pages": "/{feature}",
            "authenticated_pages": "/{feature}/{action}",
            "user_content": "/u/{username}/{content}",
            "game_rooms": "/play/{room_type}/{room_id}",
            "tournaments": "/tournaments/{tournament_id}",
            "education": "/learn/{course_type}/{course_id}/{module_id}",
            "social": "/community/{space}/{topic_id}",
            "profile": "/profile/{user_id}",
            "settings": "/settings/{section}",
            
            # API patterns
            "api_public": "/api/{resource}",
            "api_authenticated": "/api/{resource}/{action}",
            "api_admin": "/api/admin/{resource}/{action}",
            "api_websocket": "/ws/{channel}",
            
            # Asset patterns
            "static_assets": "/assets/{type}/{filename}",
            "user_uploads": "/uploads/{user_id}/{filename}",
            "cdn_content": "https://cdn.roulettecommunity.com/{path}"
        }
    
    def _create_feature_map(self) -> Dict[str, Dict]:
        """Map features to their URLs and components"""
        return {
            "gaming": {
                "routes": [
                    "/play",
                    "/play/american",
                    "/play/european",
                    "/play/vip/{table_id}",
                    "/play/tournaments"
                ],
                "api_endpoints": [
                    "/api/game/session",
                    "/api/game/bet",
                    "/api/game/history",
                    "/api/game/rng/verify"
                ],
                "components": [
                    "RouletteWheel",
                    "BettingTable",
                    "GameStats",
                    "LiveChat"
                ],
                "requires_auth": True,
                "real_time": True
            },
            
            "social": {
                "routes": [
                    "/community",
                    "/community/forums",
                    "/community/chat",
                    "/friends",
                    "/leaderboards",
                    "/achievements"
                ],
                "api_endpoints": [
                    "/api/social/friends",
                    "/api/social/achievements",
                    "/api/social/leaderboard",
                    "/api/social/activity"
                ],
                "components": [
                    "SocialDashboard",
                    "FriendsList",
                    "ActivityFeed",
                    "LeaderboardCard"
                ],
                "requires_auth": True,
                "real_time": True
            },
            
            "education": {
                "routes": [
                    "/learn",
                    "/learn/basics",
                    "/learn/strategies",
                    "/learn/probability",
                    "/learn/simulator"
                ],
                "api_endpoints": [
                    "/api/education/courses",
                    "/api/education/progress",
                    "/api/education/certificates"
                ],
                "components": [
                    "LearningAcademy",
                    "CoursePlayer",
                    "QuizModule",
                    "SimulatorModule"
                ],
                "requires_auth": False,
                "real_time": False
            },
            
            "currency": {
                "routes": [
                    "/wallet",
                    "/shop",
                    "/shop/gems",
                    "/shop/coins",
                    "/transactions"
                ],
                "api_endpoints": [
                    "/api/currency/balance",
                    "/api/currency/coins",
                    "/api/currency/purchase",
                    "/api/currency/transactions"
                ],
                "components": [
                    "CurrencyDisplay",
                    "PurchaseModal",
                    "FreeCoinsClaim",
                    "TransactionHistory"
                ],
                "requires_auth": True,
                "real_time": False
            },
            
            "premium": {
                "routes": [
                    "/vip",
                    "/vip/benefits",
                    "/vip/tiers",
                    "/subscription"
                ],
                "api_endpoints": [
                    "/api/premium/status",
                    "/api/premium/subscribe",
                    "/api/premium/benefits"
                ],
                "components": [
                    "VIPDashboard",
                    "TierProgress",
                    "BenefitsGrid",
                    "SubscriptionManager"
                ],
                "requires_auth": True,
                "real_time": False
            }
        }
    
    def generate_sitemap(self, format: str = "xml") -> str:
        """Generate sitemap in specified format"""
        sitemap = {
            "lastmod": datetime.now().isoformat(),
            "urls": []
        }
        
        for path, route in self.existing_routes.items():
            entry = {
                "loc": f"https://roulettecommunity.com{path}",
                "lastmod": datetime.now().isoformat(),
                "changefreq": route.changefreq,
                "priority": route.priority,
                "title": route.title,
                "description": route.description,
                "auth_required": route.auth_required
            }
            sitemap["urls"].append(entry)
            
            # Add child routes
            if route.children:
                for child in route.children:
                    child_entry = {
                        "loc": f"https://roulettecommunity.com{child.path}",
                        "lastmod": datetime.now().isoformat(),
                        "changefreq": child.changefreq,
                        "priority": child.priority,
                        "title": child.title,
                        "auth_required": child.auth_required
                    }
                    sitemap["urls"].append(child_entry)
        
        if format == "json":
            return json.dumps(sitemap, indent=2)
        elif format == "xml":
            return self._convert_to_xml(sitemap)
        else:
            return self._convert_to_text(sitemap)
    
    def plan_new_feature_urls(self, feature: Dict) -> Dict[str, List[str]]:
        """Plan URL structure for a new feature"""
        feature_name = feature.get('name', '').lower().replace(' ', '-')
        feature_type = feature.get('type', 'standard')
        
        url_structure = {
            "main_routes": [],
            "api_endpoints": [],
            "admin_routes": [],
            "static_assets": []
        }
        
        # Generate main routes based on feature type
        if feature_type == "gaming":
            url_structure["main_routes"] = [
                f"/play/{feature_name}",
                f"/play/{feature_name}/rules",
                f"/play/{feature_name}/stats",
                f"/play/{feature_name}/history"
            ]
            url_structure["api_endpoints"] = [
                f"/api/game/{feature_name}/session",
                f"/api/game/{feature_name}/bet",
                f"/api/game/{feature_name}/result"
            ]
            
        elif feature_type == "social":
            url_structure["main_routes"] = [
                f"/community/{feature_name}",
                f"/community/{feature_name}/feed",
                f"/community/{feature_name}/members"
            ]
            url_structure["api_endpoints"] = [
                f"/api/social/{feature_name}",
                f"/api/social/{feature_name}/posts",
                f"/api/social/{feature_name}/interactions"
            ]
            
        elif feature_type == "education":
            url_structure["main_routes"] = [
                f"/learn/{feature_name}",
                f"/learn/{feature_name}/modules",
                f"/learn/{feature_name}/practice"
            ]
            url_structure["api_endpoints"] = [
                f"/api/education/{feature_name}",
                f"/api/education/{feature_name}/progress",
                f"/api/education/{feature_name}/complete"
            ]
        
        else:  # standard feature
            url_structure["main_routes"] = [
                f"/{feature_name}",
                f"/{feature_name}/overview",
                f"/{feature_name}/settings"
            ]
            url_structure["api_endpoints"] = [
                f"/api/{feature_name}",
                f"/api/{feature_name}/data",
                f"/api/{feature_name}/update"
            ]
        
        # Add admin routes for all features
        url_structure["admin_routes"] = [
            f"/admin/{feature_name}",
            f"/admin/{feature_name}/analytics",
            f"/admin/{feature_name}/settings"
        ]
        
        return url_structure
    
    def validate_url_schema(self, url: str) -> Dict[str, any]:
        """Validate if a URL follows the established patterns"""
        validation = {
            "valid": True,
            "issues": [],
            "suggestions": [],
            "seo_score": 100
        }
        
        # Check URL length
        if len(url) > 100:
            validation["issues"].append("URL too long (>100 chars)")
            validation["seo_score"] -= 20
        
        # Check for special characters
        if any(char in url for char in ['?', '&', '#', '@', '!', '$']):
            validation["issues"].append("Contains special characters")
            validation["suggestions"].append("Use hyphens instead of special characters")
            validation["seo_score"] -= 15
        
        # Check for uppercase
        if url != url.lower():
            validation["issues"].append("Contains uppercase letters")
            validation["suggestions"].append("Convert to lowercase")
            validation["seo_score"] -= 10
        
        # Check for underscores
        if '_' in url:
            validation["suggestions"].append("Use hyphens instead of underscores")
            validation["seo_score"] -= 5
        
        # Check depth
        depth = len([p for p in url.split('/') if p])
        if depth > 4:
            validation["suggestions"].append(f"URL depth is {depth}, consider flattening")
            validation["seo_score"] -= 10
        
        validation["valid"] = len(validation["issues"]) == 0
        
        return validation
    
    def analyze_navigation_flow(self) -> Dict[str, List[str]]:
        """Analyze and optimize navigation paths between features"""
        navigation_flows = {
            "onboarding_flow": [
                "/",
                "/auth/signup",
                "/onboarding/welcome",
                "/onboarding/preferences",
                "/learn/basics",
                "/play"
            ],
            
            "gaming_flow": [
                "/dashboard",
                "/play",
                "/play/american",
                "/wallet",
                "/transactions"
            ],
            
            "learning_flow": [
                "/learn",
                "/learn/basics",
                "/learn/strategies",
                "/learn/simulator",
                "/play"
            ],
            
            "social_flow": [
                "/dashboard",
                "/community",
                "/friends",
                "/leaderboards",
                "/achievements"
            ],
            
            "purchase_flow": [
                "/wallet",
                "/shop/gems",
                "/shop/checkout",
                "/shop/success",
                "/play"
            ],
            
            "vip_upgrade_flow": [
                "/profile",
                "/vip",
                "/vip/benefits",
                "/subscription",
                "/subscription/success"
            ]
        }
        
        return navigation_flows
    
    def recommend_seo_improvements(self) -> List[Dict]:
        """Provide SEO recommendations for URL structure"""
        recommendations = [
            {
                "category": "URL Structure",
                "recommendations": [
                    "Use descriptive, keyword-rich URLs",
                    "Keep URLs under 60 characters when possible",
                    "Use hyphens to separate words",
                    "Avoid dynamic parameters in URLs",
                    "Implement canonical URLs for duplicate content"
                ]
            },
            {
                "category": "American Roulette Focus",
                "recommendations": [
                    "Include 'american-roulette' in gaming URLs",
                    "Differentiate from European roulette in URL structure",
                    "Highlight double-zero in URL parameters",
                    "Create dedicated landing pages for American roulette",
                    "Use location-based URLs for US markets"
                ]
            },
            {
                "category": "Deep Linking",
                "recommendations": [
                    "Implement app deep links for mobile",
                    "Create shareable game session URLs",
                    "Enable direct links to specific tables",
                    "Support referral code in URLs",
                    "Add social sharing parameters"
                ]
            },
            {
                "category": "Performance",
                "recommendations": [
                    "Implement URL prefetching for common paths",
                    "Use route-based code splitting",
                    "Cache static routes aggressively",
                    "Optimize API endpoint grouping",
                    "Implement progressive enhancement"
                ]
            }
        ]
        
        return recommendations
    
    def generate_navigation_menu(self) -> Dict:
        """Generate navigation menu structure"""
        return {
            "main_navigation": [
                {"label": "Play", "path": "/play", "icon": "roulette", "auth": True},
                {"label": "Learn", "path": "/learn", "icon": "education", "auth": False},
                {"label": "Community", "path": "/community", "icon": "users", "auth": True},
                {"label": "Tournaments", "path": "/tournaments", "icon": "trophy", "auth": True},
                {"label": "VIP", "path": "/vip", "icon": "crown", "auth": True}
            ],
            
            "user_menu": [
                {"label": "Dashboard", "path": "/dashboard", "icon": "home"},
                {"label": "Profile", "path": "/profile", "icon": "user"},
                {"label": "Wallet", "path": "/wallet", "icon": "wallet"},
                {"label": "Friends", "path": "/friends", "icon": "users"},
                {"label": "Settings", "path": "/settings", "icon": "settings"},
                {"label": "Logout", "path": "/auth/logout", "icon": "logout"}
            ],
            
            "footer_navigation": [
                {
                    "section": "Game",
                    "links": [
                        {"label": "Play American Roulette", "path": "/play/american"},
                        {"label": "Game Rules", "path": "/learn/rules"},
                        {"label": "Strategies", "path": "/learn/strategies"},
                        {"label": "Probability Calculator", "path": "/tools/calculator"}
                    ]
                },
                {
                    "section": "Community",
                    "links": [
                        {"label": "Forums", "path": "/community/forums"},
                        {"label": "Leaderboards", "path": "/leaderboards"},
                        {"label": "Tournaments", "path": "/tournaments"},
                        {"label": "Watch Parties", "path": "/watch-parties"}
                    ]
                },
                {
                    "section": "Support",
                    "links": [
                        {"label": "Help Center", "path": "/help"},
                        {"label": "Contact", "path": "/contact"},
                        {"label": "Terms", "path": "/terms"},
                        {"label": "Privacy", "path": "/privacy"}
                    ]
                }
            ]
        }
    
    def _convert_to_xml(self, sitemap: Dict) -> str:
        """Convert sitemap to XML format"""
        xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        
        for url in sitemap["urls"]:
            xml += '  <url>\n'
            xml += f'    <loc>{url["loc"]}</loc>\n'
            xml += f'    <lastmod>{url["lastmod"]}</lastmod>\n'
            xml += f'    <changefreq>{url["changefreq"]}</changefreq>\n'
            xml += f'    <priority>{url["priority"]}</priority>\n'
            xml += '  </url>\n'
        
        xml += '</urlset>'
        return xml
    
    def _convert_to_text(self, sitemap: Dict) -> str:
        """Convert sitemap to readable text format"""
        text = "ROULETTE COMMUNITY SITEMAP\n"
        text += "=" * 50 + "\n\n"
        
        for url in sitemap["urls"]:
            text += f"📍 {url['title']}\n"
            text += f"   URL: {url['loc']}\n"
            text += f"   Auth: {'Yes' if url['auth_required'] else 'No'}\n"
            text += f"   Priority: {url['priority']}\n"
            text += f"   Update: {url['changefreq']}\n\n"
        
        return text


# Example usage and testing
if __name__ == "__main__":
    architect = SiteArchitectureSpecialist()
    
    # Generate sitemap
    print("SITE ARCHITECTURE ANALYSIS")
    print("=" * 50)
    
    # Show existing routes
    print("\nEXISTING ROUTES:")
    for path, route in architect.existing_routes.items():
        print(f"  {path} - {route.title}")
    
    # Plan new feature URLs
    new_feature = {
        "name": "Live Streaming",
        "type": "social"
    }
    
    print(f"\nNEW FEATURE URL PLANNING: {new_feature['name']}")
    urls = architect.plan_new_feature_urls(new_feature)
    for category, paths in urls.items():
        if paths:
            print(f"  {category}:")
            for path in paths:
                print(f"    - {path}")
    
    # Validate a URL
    print("\nURL VALIDATION:")
    test_url = "/play/american-roulette/table-123"
    validation = architect.validate_url_schema(test_url)
    print(f"  URL: {test_url}")
    print(f"  Valid: {validation['valid']}")
    print(f"  SEO Score: {validation['seo_score']}/100")
    
    # Navigation flows
    print("\nNAVIGATION FLOWS:")
    flows = architect.analyze_navigation_flow()
    for flow_name, paths in flows.items():
        print(f"  {flow_name}: {' → '.join(paths)}")