# StreamSync Backend — Master Engineering Specification

Version: 1.0.0
Status: Active Development

Product:
StreamSync — Real-Time Collaborative Workspace

Backend Stack:

- Python
- Django
- Django REST Framework
- PostgreSQL
- Redis
- Django Channels
- Celery
- JWT Authentication
- WebSockets
- Docker

Primary Responsibilities:

- Authentication
- Authorization
- Workspace management
- Project management
- Document management
- Real-time collaboration
- Tasks
- Comments
- Activity
- Notifications
- Version history
- AI orchestration
- Search
- Background jobs
- API security

The backend must be designed as a real production SaaS backend.

---

# 1. ARCHITECTURE

Target architecture:

React
    |
    | HTTPS
    v
Django REST API
    |
    +---- PostgreSQL
    |
    +---- Redis
    |
    +---- Celery
    |
    +---- AI Service
    |
    +---- Django Channels
              |
              v
          WebSockets

Responsibilities:

Django REST Framework:
- CRUD
- authentication
- authorization
- business APIs

PostgreSQL:
- persistent application data

Redis:
- caching
- Channels layer
- temporary state

Django Channels:
- WebSocket connections
- real-time events

Celery:
- background jobs
- AI tasks
- notifications
- asynchronous processing

AI provider:
- accessed ONLY by backend

---

# 2. CORE PRINCIPLES

Follow these principles:

1. Security first.
2. Validate all input.
3. Never trust the frontend.
4. Enforce permissions server-side.
5. Keep business logic out of serializers where possible.
6. Keep views thin.
7. Use service layers for complex operations.
8. Use transactions for multi-step database operations.
9. Avoid duplicated logic.
10. Use typed and predictable API responses.
11. Never expose secrets.
12. Never expose internal database details.
13. Optimize only when necessary.
14. Write maintainable code.
15. Document important architectural decisions.

---

# 3. DJANGO STRUCTURE

Use:

backend/
├── manage.py
├── config/
│   ├── settings/
│   │   ├── base.py
│   │   ├── development.py
│   │   └── production.py
│   ├── urls.py
│   ├── asgi.py
│   ├── wsgi.py
│   └── routing.py
│
├── apps/
│   ├── accounts/
│   ├── workspaces/
│   ├── projects/
│   ├── documents/
│   ├── collaboration/
│   ├── tasks/
│   ├── comments/
│   ├── activity/
│   ├── notifications/
│   ├── ai/
│   └── search/
│
├── common/
│   ├── permissions/
│   ├── pagination/
│   ├── exceptions/
│   ├── middleware/
│   └── utils/
│
├── tests/
├── requirements/
├── docker/
└── .env.example

---

# 4. DATABASE

Use PostgreSQL.

Never use SQLite for production.

Database design must include:

- proper indexes
- foreign keys
- unique constraints
- timestamps
- appropriate deletion behavior

Use UUIDs for public object IDs where appropriate.

---

# 5. USERS

Custom User model.

User fields:

- id
- email
- name
- avatar
- is_active
- is_staff
- created_at
- updated_at

Email should be the primary authentication identifier.

---

# 6. WORKSPACES

Workspace:

- id
- name
- slug
- description
- owner
- created_at
- updated_at

Workspace membership:

- id
- workspace
- user
- role
- joined_at

Roles:

OWNER
EDITOR
VIEWER

Enforce unique:

workspace + user

---

# 7. PROJECTS

Project:

- id
- workspace
- name
- slug
- description
- status
- owner
- created_at
- updated_at

Statuses:

ACTIVE
ARCHIVED
COMPLETED

Projects belong to workspaces.

Users must have workspace access before accessing projects.

---

# 8. DOCUMENTS

Document:

- id
- workspace
- project
- title
- content
- created_by
- updated_by
- created_at
- updated_at

Documents may optionally belong to projects.

Document permissions must respect workspace membership.

---

# 9. DOCUMENT VERSIONS

DocumentVersion:

- id
- document
- version_number
- content
- created_by
- created_at
- summary

Unique:

document + version_number

Version history must be immutable.

---

# 10. TASKS

Task:

- id
- workspace
- project
- title
- description
- status
- priority
- assignee
- creator
- due_date
- created_at
- updated_at

Statuses:

TODO
IN_PROGRESS
REVIEW
DONE

Priority:

LOW
MEDIUM
HIGH
URGENT

---

# 11. COMMENTS

Comment:

- id
- workspace
- document
- task
- author
- parent
- content
- is_resolved
- created_at
- updated_at

A comment may belong to:

Document
OR
Task

Not both.

Support threaded replies.

---

# 12. ACTIVITY

Activity:

- id
- workspace
- actor
- action
- entity_type
- entity_id
- metadata
- created_at

Examples:

DOCUMENT_CREATED
DOCUMENT_UPDATED
TASK_CREATED
TASK_COMPLETED
MEMBER_INVITED
COMMENT_CREATED
AI_SUMMARY_GENERATED

Activity should be append-only.

---

# 13. NOTIFICATIONS

Notification:

- id
- user
- workspace
- type
- title
- message
- entity_type
- entity_id
- is_read
- created_at

Support:

- mention
- assignment
- invitation
- document share
- task update

---

# 14. AI

AI must ONLY be accessed from the backend.

Endpoints may include:

POST /api/ai/summarize/
POST /api/ai/action-items/
POST /api/ai/improve/
POST /api/ai/ask/

Never expose AI API keys.

AI operations should be logged.

---

# 15. WEBSOCKETS

Document WebSocket:

/ws/documents/<document_id>/

Events:

document.join
document.leave
document.update
document.sync
document.cursor
document.selection
document.presence
document.saved
document.error

All WebSocket connections require authentication.

Authorization must happen before joining a document room.

---

# 16. REAL-TIME SECURITY

Never trust:

document_id
user_id
workspace_id

sent by clients.

Verify everything server-side.

A user may only connect to documents they are authorized to access.

---

# 17. API DESIGN

Use RESTful APIs.

Use:

GET
POST
PATCH
DELETE

Return predictable JSON responses.

Use pagination for lists.

Use filtering where useful.

Use ordering where useful.

---

# 18. ERROR HANDLING

Use consistent error responses.

Example:

{
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "The requested document could not be found."
  }
}

Never return raw Python exceptions.

Never expose stack traces in production.

---

# 19. AUTHENTICATION

Use JWT.

Endpoints:

POST /api/auth/register/
POST /api/auth/login/
POST /api/auth/refresh/
POST /api/auth/logout/

Use secure token handling.

Access token:
short-lived

Refresh token:
longer-lived

---

# 20. AUTHORIZATION

Backend authorization is mandatory.

Examples:

Viewer:
- read
- cannot edit

Editor:
- read
- edit

Owner:
- full workspace control

Always enforce permissions server-side.

---

# 21. TRANSACTIONS

Use database transactions for operations such as:

- creating workspace + owner membership
- creating project
- creating document + initial version
- restoring document version
- inviting member
- completing task + activity
- AI action + activity

---

# 22. BACKGROUND JOBS

Use Celery for:

- AI processing
- email notifications
- large activity processing
- cleanup
- asynchronous tasks

Do not block HTTP requests unnecessarily.

---

# 23. REDIS

Redis may be used for:

- Channels
- caching
- rate limiting
- temporary state
- Celery broker

Do not use Redis as the primary persistent database.

---

# 24. RATE LIMITING

Protect sensitive endpoints.

Examples:

- login
- register
- password reset
- AI endpoints
- invitations

Prevent abuse.

---

# 25. SECURITY

Production backend must include:

- CORS configuration
- CSRF configuration where appropriate
- secure cookies where used
- secure headers
- HTTPS
- secret management
- rate limiting
- input validation
- permission checks

Never commit `.env`.

---

# 26. TESTING

Write tests for:

- authentication
- permissions
- workspace isolation
- project access
- document access
- task permissions
- comments
- version history
- AI authorization
- WebSocket authorization
- activity
- notifications

Critical business logic must have automated tests.

---

# 27. PERFORMANCE

Use:

- select_related
- prefetch_related
- database indexes
- pagination
- query optimization

Avoid N+1 queries.

Do not optimize blindly.

Measure first where possible.

---

# 28. API DOCUMENTATION

Provide OpenAPI documentation.

Document:

- authentication
- request body
- response
- errors
- permissions

---

# 29. ENVIRONMENT

Use:

.env

and:

.env.example

Never commit secrets.

Example variables:

DJANGO_SECRET_KEY=
DEBUG=
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
AI_API_KEY=
CORS_ALLOWED_ORIGINS=

---

# 30. DOCKER

Provide:

Dockerfile
docker-compose.yml

Services:

backend
postgres
redis
worker

Development should be reproducible.

---

# 31. LOGGING

Use structured logging where practical.

Log:

- request ID
- endpoint
- status
- duration
- important business events

Never log:

- passwords
- tokens
- API keys
- sensitive user data

---

# 32. BACKEND DEVELOPMENT MILESTONES

The backend must be developed through 10 controlled milestones.

Do not attempt to implement all milestones simultaneously.

---

# MILESTONE 1

Project foundation.

Build:

- Django project
- settings
- PostgreSQL
- environment configuration
- DRF
- CORS
- custom User model
- health endpoint
- Docker foundation
- basic testing setup

Run tests and verify database connection.

---

# MILESTONE 2

Authentication.

Build:

- registration
- login
- JWT
- refresh
- logout
- current user
- authentication permissions

Test:

- valid login
- invalid login
- expired token
- unauthorized request

---

# MILESTONE 3

Workspace + Membership.

Build:

- workspace creation
- workspace list
- workspace detail
- membership
- roles
- invitations
- permissions

Implement workspace isolation.

A user must never access another user's private workspace data.

---

# MILESTONE 4

Projects + Documents.

Build:

- project CRUD
- document CRUD
- project/document relationships
- permissions
- search/filter
- pagination

Create document initial version.

---

# MILESTONE 5

Tasks + Comments.

Build:

- task CRUD
- task assignment
- statuses
- priorities
- comments
- threaded replies
- comment resolution

Create activity records for important changes.

---

# MILESTONE 6

Version History + Activity.

Build:

- immutable document versions
- version listing
- restore version
- activity timeline
- activity metadata

Use transactions.

Version restoration must create a new version rather than modifying old versions.

---

# MILESTONE 7

WebSockets + Real-Time Collaboration.

Build:

- Django Channels
- Redis channel layer
- authenticated WebSockets
- document rooms
- presence
- join/leave
- document updates
- cursor events
- connection management
- reconnect support

Implement the initial server-authoritative synchronization model.

Do not claim CRDT/OT support unless actually implemented.

---

# MILESTONE 8

Notifications + Background Jobs.

Build:

- notification system
- unread counts
- Celery
- Redis broker
- background notification tasks
- AI job architecture

Add appropriate indexes.

---

# MILESTONE 9

AI Service.

Build backend AI abstraction.

AI operations:

- summarize document
- extract action items
- improve text
- ask about document

Architecture:

API
↓
AI service
↓
Provider

AI API keys remain server-side.

Add rate limits.

Log AI operations without storing unnecessary sensitive content.

---

# MILESTONE 10

Production hardening.

Review:

- security
- authentication
- permissions
- database indexes
- N+1 queries
- API errors
- WebSocket security
- rate limiting
- logging
- tests
- OpenAPI
- Docker
- environment configuration

Run:

pytest
python manage.py check
python manage.py makemigrations --check
python manage.py migrate --check

Fix all critical problems.

---

# 33. API ENDPOINT STRUCTURE

Use:

/api/auth/

/api/workspaces/

/api/projects/

/api/documents/

/api/tasks/

/api/comments/

/api/activity/

/api/notifications/

/api/ai/

WebSockets:

/ws/documents/<document_id>/

---

# 34. SERIALIZERS

Serializers should handle:

- validation
- representation

Complex business logic should live in services.

Avoid putting large business workflows inside serializers.

---

# 35. VIEWS

Views should:

1. authenticate
2. validate
3. authorize
4. call service
5. return response

Avoid massive views.

---

# 36. SERVICES

Use service modules for complex workflows.

Examples:

workspace_service.py
document_service.py
version_service.py
task_service.py
notification_service.py
ai_service.py

---

# 37. PERMISSIONS

Create reusable permission classes.

Examples:

IsWorkspaceMember
IsWorkspaceOwner
CanEditWorkspace
CanEditDocument
CanViewDocument

Do not duplicate permission logic across views.

---

# 38. DATABASE INDEXES

Add indexes where appropriate.

Potential indexes:

Workspace membership:
workspace_id
user_id

Documents:
workspace_id
project_id
updated_at

Tasks:
workspace_id
project_id
assignee_id
status

Activity:
workspace_id
created_at

Notifications:
user_id
is_read
created_at

---

# 39. SOFT DELETE

Use soft deletion only where product requirements justify it.

Do not automatically add soft deletion everywhere.

For important entities, consider whether deletion should be:

- permanent
- archived
- soft deleted

Document versions should never be silently deleted.

---

# 40. AUDITABILITY

Important actions should create activity records.

Examples:

User A
created document
"Payment Architecture"

User B
assigned task
"Implement Stripe integration"

User C
completed task

This makes the platform useful for teams.

---

# 41. WEB SOCKET EVENT FORMAT

Use predictable events.

Example:

{
  "type": "document.update",
  "document_id": "uuid",
  "user_id": "uuid",
  "payload": {}
}

Do not trust client-supplied user_id.

The server should derive the authenticated user.

---

# 42. PRESENCE

Presence should track:

- user
- document
- connection
- status
- last_seen

Statuses:

ONLINE
IDLE
OFFLINE

Presence is temporary state.

Do not unnecessarily persist high-frequency cursor events in PostgreSQL.

---

# 43. CURSOR EVENTS

Cursor events are ephemeral.

They should generally flow through:

WebSocket
→ Redis/channel layer
→ connected clients

Do not write every cursor movement to PostgreSQL.

---

# 44. DOCUMENT UPDATES

Document changes require careful synchronization.

Initial architecture may use:

server-authoritative updates.

Future architecture may introduce:

CRDT
or
OT

If implementing CRDT:

document the algorithm and library.

---

# 45. AI ACTION ITEMS

AI may return:

{
  "action_items": [
    {
      "title": "Implement Stripe API",
      "priority": "HIGH",
      "suggested_assignee": null
    }
  ]
}

The user must confirm before creating tasks.

AI must not silently create destructive or important actions.

---

# 46. AI FAILURE

If AI fails:

Return a clear API error.

Do not crash the application.

Example:

{
  "error": {
    "code": "AI_SERVICE_UNAVAILABLE",
    "message": "AI assistance is temporarily unavailable."
  }
}

---

# 47. SEARCH

Initial search may use PostgreSQL search capabilities.

Search:

- documents
- projects
- tasks

Do not introduce Elasticsearch unless the scale actually requires it.

---

# 48. PAGINATION

Use pagination for:

- projects
- documents
- tasks
- comments
- activity
- notifications

Do not return unlimited records.

---

# 49. API RESPONSE CONSISTENCY

Use consistent status codes.

200:
successful retrieval/update

201:
created

204:
successful deletion

400:
validation error

401:
authentication required

403:
permission denied

404:
resource not found

429:
rate limited

500:
unexpected server error

---

# 50. PRODUCTION STANDARD

The backend should not feel like:

- tutorial code
- a CRUD demo
- one giant views.py
- one giant models.py
- untested business logic

It should demonstrate:

- architecture
- security
- scalability
- testing
- real-time engineering
- API design
- database design
- asynchronous processing

---

# 51. CLAUDE CODE RULES

Before every task:

1. Read CLAUDE.md.
2. Inspect existing code.
3. Understand current architecture.
4. Reuse existing services.
5. Avoid unnecessary rewrites.

After every task:

1. Run tests.
2. Run Django checks.
3. Check migrations.
4. Fix errors.
5. Explain what changed.

Never:

- delete working functionality without reason
- expose secrets
- bypass permissions
- trust frontend authorization
- create giant files
- duplicate business logic
- install unnecessary packages
- claim functionality exists when it is mocked

---

# 52. DEFINITION OF DONE

A backend feature is complete only when:

- implementation exists
- validation exists
- permissions exist
- API endpoint exists
- tests exist
- error handling exists
- documentation exists
- migrations are correct
- performance is reasonable

---

# 53. FINAL BACKEND DEMO

The final backend should support this flow:

User registers
↓
Creates workspace
↓
Invites member
↓
Creates project
↓
Creates document
↓
Second user opens document
↓
Both users connect through WebSocket
↓
Changes synchronize
↓
Comment added
↓
Activity recorded
↓
Task created
↓
Notification generated
↓
AI summarizes document
↓
AI extracts action items
↓
User confirms action items
↓
Tasks created
↓
Version history updated

---

# 54. FINAL SUCCESS CRITERIA

StreamSync backend is successful when:

- authentication works
- JWT works
- workspace isolation works
- roles work
- projects work
- documents work
- tasks work
- comments work
- activity works
- notifications work
- version history works
- WebSockets work
- presence works
- AI integration works
- rate limiting exists
- tests pass
- API documentation exists
- Docker environment works
- production configuration is secure

---

# 55. MOST IMPORTANT PRINCIPLE

Build a smaller system correctly before making it larger.

Prioritize:

Security
Correctness
Maintainability
Real-time reliability
API quality
Testing

Do not chase feature count.

StreamSync should demonstrate real engineering depth.