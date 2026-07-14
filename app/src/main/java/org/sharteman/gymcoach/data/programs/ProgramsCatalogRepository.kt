package org.sharteman.gymcoach.data.programs

class ProgramsCatalogRepository(
    private val remote: ProgramsCatalogDataSource,
) : ProgramsCatalogDataSource by remote {
    companion object {
        fun remote(baseUrl: String, token: String): ProgramsCatalogRepository =
            ProgramsCatalogRepository(ProgramsCatalogApi(baseUrl, token))
    }
}
