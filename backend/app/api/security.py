from fastapi import HTTPException, Request, status

LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost", "testclient"}


async def require_local_request(request: Request) -> None:
    host = request.client.host if request.client else ""
    if host not in LOCAL_CLIENTS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action is available only from the local machine.",
        )
