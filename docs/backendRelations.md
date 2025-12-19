# Backend Relations & Types API

This module manages the integration with external backend services (e.g., AI providers like OpenAI, Anthropic) and their configuration within organizations.

## Base URL
All endpoints are prefixed with `/backendRelations`.

## Authentication
Required headers for all requests:
- `Authorization`: Bearer token (JWT)
- `orgId`: The ID of the organization context

---

## 1. Backend Types
*Definitions of supported external services (Configured in `src/config/backendTypes.json`).*

### Get Available Backend Types
Retrieves the list of all backend types supported by the system.

- **URL**: `/types`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "data": [
      {
        "id": "openai",
        "name": "OpenAI",
        "isActive": true
      },
      {
        "id": "anthropic",
        "name": "Anthropic",
        "isActive": true
      }
    ]
  }
  ```

---

## 2. Backend Relations
*Configured connections between an organization and a backend type.*

### Get Organization Backends
Retrieves all configured backends for the current organization.

- **URL**: `/`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "data": [
      {
        "id": 1,
        "organizationId": 1,
        "backendId": "openai",
        "backendTypeName": "OpenAI",
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "sk-...",
        "isActive": true,
        "createdAt": 1700000000,
        "updatedAt": 1700000000
      }
    ]
  }
  ```

### Get Backend Relation Details
Retrieves a specific backend configuration.

- **URL**: `/:id`
- **Method**: `GET`
- **Parameters**:
  - `id`: The ID of the backend relation
- **Response**:
  ```json
  {
    "data": {
      "id": 1,
      "organizationId": 1,
      "backendId": "openai",
      "backendTypeName": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "isActive": true,
      "createdAt": 1700000000,
      "updatedAt": 1700000000
    }
  }
  ```

### Create Backend Relation
Connects a new backend type to the organization.

- **URL**: `/`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "backendId": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "isActive": true
  }
  ```
- **Response**:
  ```json
  {
    "data": {
      "id": 2,
      "organizationId": 1,
      "backendId": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "isActive": true,
      "createdAt": 1700000000,
      "updatedAt": 1700000000
    }
  }
  ```

### Update Backend Relation
Updates an existing backend configuration.

- **URL**: `/:id`
- **Method**: `PUT`
- **Parameters**:
  - `id`: The ID of the backend relation
- **Body** (Partial):
  ```json
  {
    "apiKey": "new-api-key",
    "isActive": false
  }
  ```
- **Response**:
  ```json
  {
    "data": {
      "id": 1,
      "organizationId": 1,
      "backendId": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "new-api-key",
      "isActive": false,
      "createdAt": 1700000000,
      "updatedAt": 1700000000
    }
  }
  ```

### Delete Backend Relation
Removes a backend configuration.

- **URL**: `/:id`
- **Method**: `DELETE`
- **Parameters**:
  - `id`: The ID of the backend relation
- **Response**:
  ```json
  {
    "data": {
      "id": 1,
      "organizationId": 1,
      "backendId": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "new-api-key",
      "isActive": false,
      "createdAt": 1700000000,
      "updatedAt": 1700000000
    },
    "success": true
  }
  ```
