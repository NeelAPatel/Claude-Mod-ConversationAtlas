# Recipe Sharing API Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/recipes` | List recipes with optional search and filtering. |
| POST | `/recipes` | Create a recipe for the authenticated user. |
| GET | `/recipes/{recipeId}` | Retrieve a recipe and its details. |
| PUT | `/recipes/{recipeId}` | Replace a recipe owned by the authenticated user. |
| DELETE | `/recipes/{recipeId}` | Delete a recipe owned by the authenticated user. |
| POST | `/recipes/{recipeId}/reviews` | Add a rating and review to a recipe. |
