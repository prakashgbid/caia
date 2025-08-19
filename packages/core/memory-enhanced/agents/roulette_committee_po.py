#!/usr/bin/env python3
"""
Enhanced Product Owner for Roulette Committee Project
Conducts thorough interviews to understand vision completely
"""

import json
from datetime import datetime
from typing import Dict, List, Any

class RouletteCommitteeProductOwner:
    """
    Specialized PO for Roulette Community project
    Asks comprehensive questions to understand vision perfectly
    Focus on American Roulette gaming platform
    """
    
    def __init__(self):
        self.project_name = "Roulette Community"
        self.vision = {}
        self.interview_questions = self._prepare_interview_questions()
        self.responses = {}
        self.american_roulette_focus = True
        
    def _prepare_interview_questions(self) -> Dict[str, List[str]]:
        """
        Prepare comprehensive interview questions organized by category
        """
        return {
            "vision_and_purpose": [
                "What is the core purpose of the Roulette Community platform?",
                "What problem does it solve that existing roulette platforms don't?",
                "What is your vision for this platform in 1 year? 5 years?",
                "What makes this American roulette platform unique in the market?",
                "What is the elevator pitch for Roulette Community?",
                "Why focus on American roulette specifically?",
                "How important is the community aspect vs the gaming aspect?"
            ],
            "target_audience": [
                "Who are the primary users of this platform?",
                "What are the demographics of your target audience?",
                "What are the pain points of your users?",
                "How tech-savvy are your users?",
                "What devices will they primarily use (mobile/desktop/tablet)?",
                "How many users do you expect in the first year?"
            ],
            "core_features": [
                "What are the MUST-HAVE features for launch?",
                "What features can wait for version 2?",
                "Should we support both American and European roulette or just American?",
                "What social features are most important (chat, friends, tournaments)?",
                "Do you want live streaming capabilities for games?",
                "Will there be real money transactions or virtual currency only?",
                "Do you need tournament and competition features?",
                "Should we have educational content about roulette strategies?",
                "Do you want VIP tables or membership tiers?",
                "Will there be chat or communication features during games?",
                "Do you need detailed analytics and game history?",
                "Should we have a referral/affiliate program?",
                "Do you want achievement and gamification features?"
            ],
            "technical_requirements": [
                "Do you have any preferred technology stack?",
                "Do you need mobile apps or just web?",
                "What browsers must be supported?",
                "Do you need offline functionality?",
                "What are the performance requirements (load time, concurrent users)?",
                "Do you need API integrations with other services?",
                "What are the security requirements?",
                "Do you need data encryption?",
                "What compliance requirements exist (GDPR, gaming licenses, etc.)?"
            ],
            "design_and_ux": [
                "Do you have existing brand guidelines or colors?",
                "What's the desired look and feel (professional/playful/serious)?",
                "Do you have competitor sites you like/dislike?",
                "What accessibility requirements do you have?",
                "Should it be mobile-first or desktop-first design?",
                "Do you need dark mode support?",
                "Any specific UI components you envision?",
                "Do you have wireframes or mockups?"
            ],
            "business_model": [
                "How will the platform make money?",
                "Is it subscription-based, transaction-based, or free-to-play with purchases?",
                "Will you use a dual currency system (gems/coins)?",
                "Will there be different VIP tiers or membership levels?",
                "Do you need Stripe or other payment processing?",
                "What payment methods should be supported?",
                "How will you handle legal compliance for online gaming?",
                "Will you operate as a sweepstakes model or social casino?"
            ],
            "content_and_data": [
                "What type of content will be on the platform?",
                "Who will create and manage content?",
                "Do you need a CMS (Content Management System)?",
                "What data needs to be stored?",
                "How long should data be retained?",
                "Do you need data export capabilities?",
                "Will there be user-generated content?"
            ],
            "launch_and_timeline": [
                "When do you need the MVP launched?",
                "What is your budget range?",
                "Do you have a hard deadline?",
                "Will this be a phased launch or big bang?",
                "What markets/regions will you launch in?",
                "Do you need beta testing phase?"
            ],
            "success_metrics": [
                "How will you measure success?",
                "What are your KPIs (Key Performance Indicators)?",
                "What are the success metrics for year 1?",
                "What would make this project a failure?",
                "What analytics do you need to track?"
            ],
            "risks_and_constraints": [
                "What are the main risks to this project?",
                "What constraints do we need to work within?",
                "Are there any legal considerations?",
                "What are your biggest concerns?",
                "What keeps you up at night about this project?"
            ],
            "american_roulette_specifics": [
                "Why did you choose American roulette over European roulette?",
                "Should we emphasize the double zero (00) as a feature?",
                "Do you want to highlight the 5.26% house edge transparently?",
                "Should we offer the five-number bet (0-00-1-2-3)?",
                "Do you want side bets or progressive jackpots?",
                "Should we show hot/cold numbers and statistics?",
                "Do you want to offer racetrack betting layout?",
                "Should we have quick bet options (neighbors, orphans, etc.)?",
                "Do you want surrender rules (La Partage/En Prison)?",
                "Should we support both inside and outside bet limits?"
            ],
            "community_and_social": [
                "How important are social features vs solo play?",
                "Do you want public and private tables?",
                "Should players be able to create their own tables?",
                "Do you want spectator mode for watching others play?",
                "Should we have table chat and emojis?",
                "Do you want friend invites and challenges?",
                "Should we have clan or team features?",
                "Do you want seasonal events and competitions?",
                "Should high wins be celebrated publicly?",
                "Do you want tipping or gifting between players?"
            ],
            "differentiation": [
                "What will make players choose your platform over competitors?",
                "What unique features should we prioritize?",
                "How do we attract American roulette enthusiasts specifically?",
                "Should we focus on casual players or serious gamblers?",
                "What's your stance on responsible gaming features?",
                "Do you want AI-powered features or predictions?",
                "Should we have celebrity or branded tables?",
                "Do you want integration with sports betting or other games?",
                "Should we offer cryptocurrency support?",
                "How important is mobile app vs web experience?"
            ]
        }
    
    def conduct_interview(self) -> Dict[str, List[str]]:
        """
        Return all interview questions for the user to answer
        """
        print("\n" + "="*60)
        print("🎙️ ROULETTE COMMUNITY - PRODUCT OWNER INTERVIEW")
        print("="*60)
        print("\nThank you for choosing to build the Roulette Community platform!")
        print("To ensure we build exactly what you envision, I need to understand")
        print("your requirements thoroughly. Please answer the following questions:\n")
        
        all_questions = []
        question_number = 1
        
        for category, questions in self.interview_questions.items():
            print(f"\n📋 {category.replace('_', ' ').upper()}")
            print("-" * 40)
            
            for question in questions:
                print(f"{question_number}. {question}")
                all_questions.append({
                    'number': question_number,
                    'category': category,
                    'question': question
                })
                question_number += 1
        
        print("\n" + "="*60)
        print("Please provide answers to these questions.")
        print("You can answer them in any format - I'll extract the key information.")
        print("\nTotal Questions: {}".format(question_number - 1))
        print("Estimated time to answer: 30-45 minutes")
        print("="*60 + "\n")
        
        return all_questions
    
    def process_interview_responses(self, responses: Dict) -> Dict:
        """
        Process interview responses and create comprehensive vision
        """
        self.responses = responses
        
        # Extract vision from responses
        self.vision = {
            'project_name': 'Roulette Committee',
            'mission': responses.get('mission', 'Create an innovative committee decision-making platform'),
            'vision_statement': responses.get('vision', 'The future of collaborative decision-making'),
            
            'target_users': self._extract_target_users(responses),
            'core_features': self._extract_core_features(responses),
            'technical_stack': self._extract_tech_stack(responses),
            'design_requirements': self._extract_design_requirements(responses),
            'business_model': self._extract_business_model(responses),
            
            'timeline': responses.get('timeline', '6 days'),
            'budget': responses.get('budget', 'optimize for speed'),
            'success_metrics': self._extract_success_metrics(responses),
            'constraints': self._extract_constraints(responses),
            
            'epics': self._generate_epics(responses),
            'priorities': self._determine_priorities(responses),
            'risks': self._identify_risks(responses),
            
            'created_at': datetime.now().isoformat()
        }
        
        return self.vision
    
    def _extract_target_users(self, responses: Dict) -> List[str]:
        """Extract target users from responses"""
        users = responses.get('target_users', [])
        if not users:
            # Default personas for Roulette Committee
            users = [
                'Committee Members',
                'Decision Makers',
                'Administrators',
                'Participants',
                'Observers'
            ]
        return users
    
    def _extract_core_features(self, responses: Dict) -> List[Dict]:
        """Extract and prioritize core features"""
        features = []
        
        # Essential features for Roulette Committee
        default_features = [
            {'name': 'User Authentication', 'priority': 'must-have'},
            {'name': 'Committee Creation', 'priority': 'must-have'},
            {'name': 'Member Management', 'priority': 'must-have'},
            {'name': 'Decision/Voting System', 'priority': 'must-have'},
            {'name': 'Real-time Updates', 'priority': 'must-have'},
            {'name': 'Dashboard', 'priority': 'must-have'},
            {'name': 'Notifications', 'priority': 'should-have'},
            {'name': 'Analytics', 'priority': 'should-have'},
            {'name': 'Mobile Responsive', 'priority': 'must-have'},
            {'name': 'Chat/Comments', 'priority': 'nice-to-have'}
        ]
        
        # Merge with user-specified features
        user_features = responses.get('features', [])
        if user_features:
            for feature in user_features:
                if isinstance(feature, str):
                    features.append({'name': feature, 'priority': 'must-have'})
                else:
                    features.append(feature)
        else:
            features = default_features
        
        return features
    
    def _extract_tech_stack(self, responses: Dict) -> Dict:
        """Extract technical stack preferences"""
        return {
            'frontend': responses.get('frontend', 'Next.js 14 with TypeScript'),
            'backend': responses.get('backend', 'Node.js with Express'),
            'database': responses.get('database', 'PostgreSQL with Prisma'),
            'authentication': responses.get('auth', 'NextAuth.js'),
            'styling': responses.get('styling', 'Tailwind CSS'),
            'deployment': responses.get('deployment', 'Vercel'),
            'testing': responses.get('testing', 'Jest + Cypress'),
            'state_management': responses.get('state', 'Zustand'),
            'real_time': responses.get('realtime', 'Socket.io'),
            'ui_components': responses.get('ui', 'Shadcn/ui')
        }
    
    def _extract_design_requirements(self, responses: Dict) -> Dict:
        """Extract design and UX requirements"""
        return {
            'style': responses.get('design_style', 'modern and professional'),
            'colors': responses.get('colors', {'primary': '#3B82F6', 'secondary': '#10B981'}),
            'typography': responses.get('typography', 'Inter, system fonts'),
            'responsive': responses.get('responsive', True),
            'dark_mode': responses.get('dark_mode', True),
            'accessibility': responses.get('accessibility', 'WCAG 2.1 AA'),
            'animations': responses.get('animations', 'subtle and smooth'),
            'layout': responses.get('layout', 'clean and intuitive')
        }
    
    def _extract_business_model(self, responses: Dict) -> Dict:
        """Extract business model details"""
        return {
            'type': responses.get('business_model', 'freemium'),
            'monetization': responses.get('monetization', ['subscription', 'premium features']),
            'pricing_tiers': responses.get('tiers', ['free', 'pro', 'enterprise']),
            'payment_processing': responses.get('payments', 'Stripe'),
            'currency': responses.get('currency', 'USD')
        }
    
    def _extract_success_metrics(self, responses: Dict) -> List[str]:
        """Extract success metrics"""
        metrics = responses.get('success_metrics', [])
        if not metrics:
            metrics = [
                '1000+ active users in first month',
                '100+ committees created',
                '95% uptime',
                '<2s page load time',
                '4.5+ app store rating',
                '50% user retention after 30 days'
            ]
        return metrics
    
    def _extract_constraints(self, responses: Dict) -> List[str]:
        """Extract project constraints"""
        constraints = responses.get('constraints', [])
        if not constraints:
            constraints = [
                'Must launch within timeline',
                'Must be mobile-responsive',
                'Must handle concurrent users',
                'Must be secure',
                'Must be scalable'
            ]
        return constraints
    
    def _generate_epics(self, responses: Dict) -> List[Dict]:
        """Generate epics based on features and requirements"""
        epics = []
        
        # Core epics for Roulette Committee
        epic_templates = [
            {
                'title': 'User Authentication & Authorization',
                'description': 'Complete auth system with roles and permissions',
                'stories_count': 8
            },
            {
                'title': 'Committee Management System',
                'description': 'Create, manage, and organize committees',
                'stories_count': 10
            },
            {
                'title': 'Decision/Voting Mechanism',
                'description': 'Core roulette/voting/decision functionality',
                'stories_count': 12
            },
            {
                'title': 'Real-time Communication',
                'description': 'Chat, notifications, and live updates',
                'stories_count': 8
            },
            {
                'title': 'Dashboard & Analytics',
                'description': 'User and admin dashboards with insights',
                'stories_count': 10
            },
            {
                'title': 'Mobile Responsive Design',
                'description': 'Fully responsive UI for all devices',
                'stories_count': 6
            },
            {
                'title': 'Admin Panel',
                'description': 'Administrative controls and management',
                'stories_count': 8
            },
            {
                'title': 'Payment & Subscription',
                'description': 'Payment processing and subscription management',
                'stories_count': 10
            },
            {
                'title': 'API & Integrations',
                'description': 'REST API and third-party integrations',
                'stories_count': 6
            },
            {
                'title': 'Testing & Quality Assurance',
                'description': 'Comprehensive testing suite',
                'stories_count': 8
            }
        ]
        
        for i, epic_template in enumerate(epic_templates):
            epics.append({
                'id': f'RC-EPIC-{i+1:03d}',
                'title': epic_template['title'],
                'description': epic_template['description'],
                'priority': 'high' if i < 5 else 'medium',
                'estimated_stories': epic_template['stories_count'],
                'sprint': (i // 3) + 1
            })
        
        return epics
    
    def _determine_priorities(self, responses: Dict) -> List[str]:
        """Determine feature priorities"""
        priorities = responses.get('priorities', [])
        if not priorities:
            priorities = [
                'Core committee functionality',
                'User authentication',
                'Decision/voting system',
                'Real-time updates',
                'Mobile responsiveness',
                'Dashboard',
                'Notifications',
                'Analytics',
                'Payment processing',
                'Admin panel'
            ]
        return priorities
    
    def _identify_risks(self, responses: Dict) -> List[Dict]:
        """Identify project risks"""
        risks = []
        
        default_risks = [
            {
                'risk': 'Scalability issues with real-time features',
                'impact': 'high',
                'mitigation': 'Use WebSocket clustering and load balancing'
            },
            {
                'risk': 'Complex committee logic',
                'impact': 'medium',
                'mitigation': 'Thorough testing and clear documentation'
            },
            {
                'risk': 'User adoption',
                'impact': 'high',
                'mitigation': 'Focus on UX and onboarding'
            },
            {
                'risk': 'Security vulnerabilities',
                'impact': 'high',
                'mitigation': 'Security audit and best practices'
            }
        ]
        
        user_risks = responses.get('risks', [])
        if user_risks:
            for risk in user_risks:
                if isinstance(risk, str):
                    risks.append({
                        'risk': risk,
                        'impact': 'medium',
                        'mitigation': 'To be determined'
                    })
                else:
                    risks.append(risk)
        else:
            risks = default_risks
        
        return risks
    
    def create_product_roadmap(self) -> Dict:
        """
        Create detailed product roadmap
        """
        roadmap = {
            'phase_1': {
                'name': 'MVP Launch',
                'duration': '2 days',
                'deliverables': [
                    'User authentication',
                    'Basic committee creation',
                    'Simple voting mechanism',
                    'Basic dashboard',
                    'Mobile responsive design'
                ]
            },
            'phase_2': {
                'name': 'Enhanced Features',
                'duration': '2 days',
                'deliverables': [
                    'Advanced committee features',
                    'Real-time updates',
                    'Notifications',
                    'Chat functionality',
                    'Analytics dashboard'
                ]
            },
            'phase_3': {
                'name': 'Premium & Scale',
                'duration': '2 days',
                'deliverables': [
                    'Payment integration',
                    'Subscription management',
                    'Admin panel',
                    'API development',
                    'Performance optimization'
                ]
            }
        }
        
        return roadmap


# Interview questions for immediate use
def get_interview_questions():
    """
    Get all interview questions for the Roulette Committee project
    """
    po = RouletteCommitteeProductOwner()
    return po.conduct_interview()


if __name__ == "__main__":
    # Start the interview
    po = RouletteCommitteeProductOwner()
    questions = po.conduct_interview()